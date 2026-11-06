"""Serviço de voz dos suspeitos (Kokoro-82M) no Modal.

O servidor principal roda num plano grátis de 512 MB, que não comporta o modelo de voz.
Aqui ele roda sob demanda: liga quando alguém joga, desliga 5 min depois da última fala.
Plano Starter sem cartão: US$ 1/mês de crédito com teto. Se acabar, o jogo segue só com texto.

Deploy (da raiz do projeto):
  modal secret create noir-voz VOICE_KEY=<chave longa aleatória>   # uma vez
  modal deploy deploy/modal_voice.py
O endereço gerado vai em KOKORO_URL no servidor principal, e a mesma chave em KOKORO_KEY.
"""

import modal

MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("wget")
    .pip_install("kokoro-onnx==0.6.1", "soundfile>=0.12", "fastapi[standard]")
    .run_commands(
        "mkdir -p /models",
        f"wget -q -O /models/kokoro-v1.0.onnx {MODEL_URL}/kokoro-v1.0.onnx",
        f"wget -q -O /models/voices-v1.0.bin {MODEL_URL}/voices-v1.0.bin",
    )
)

app = modal.App("noir-voz")


@app.cls(
    image=image,
    cpu=1.0,  # 1 núcleo físico (2 vCPU): ~US$ 0,05/h ligado
    memory=1024,
    max_containers=1,  # nunca mais de uma máquina: protege o crédito do mês
    scaledown_window=300,  # desliga 5 min depois da última fala
    secrets=[modal.Secret.from_name("noir-voz")],
)
@modal.concurrent(max_inputs=8)
class Voz:
    @modal.enter()
    def load(self) -> None:
        import threading

        from kokoro_onnx import Kokoro

        import os

        import onnxruntime as ort

        # O container enxerga os núcleos da máquina física inteira; sem limitar, o ONNX cria
        # threads demais para os 2 vCPU reservados e fica mais lento.
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = int(os.getenv("VOICE_THREADS", "2"))
        opts.inter_op_num_threads = 1
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        session = ort.InferenceSession("/models/kokoro-v1.0.onnx", opts, providers=["CPUExecutionProvider"])
        self.model = Kokoro.from_session(session, "/models/voices-v1.0.bin")
        self.voices = set(self.model.get_voices())
        self.lock = threading.Lock()  # uma geração por vez (CPU)
        self.model.create("Pronto.", voice="pm_alex", lang="pt-br")  # aquece

    @modal.asgi_app()
    def web(self):
        import asyncio
        import io
        import os

        import soundfile as sf
        from fastapi import FastAPI, Header, HTTPException, Response
        from pydantic import BaseModel, Field

        api = FastAPI(title="Noir voz")
        key = os.environ["VOICE_KEY"]

        class SynthRequest(BaseModel):
            text: str = Field(min_length=1, max_length=400)
            voice: str = "pm_alex"
            lang: str = "pt-br"
            speed: float = Field(default=1.0, ge=0.5, le=1.5)

        def synth(req: SynthRequest) -> bytes:
            voice = req.voice if req.voice in self.voices else ("am_michael" if req.lang.startswith("en") else "pm_alex")
            with self.lock:
                audio, rate = self.model.create(req.text, voice=voice, lang=req.lang, speed=req.speed)
            buf = io.BytesIO()
            sf.write(buf, audio, rate, format="WAV", subtype="PCM_16")
            return buf.getvalue()

        @api.get("/warm")
        def warm() -> dict:
            return {"ok": True}

        @api.post("/synth")
        async def synth_route(req: SynthRequest, x_voice_key: str = Header("")) -> Response:
            if x_voice_key != key:
                raise HTTPException(401, "chave inválida")
            wav = await asyncio.to_thread(synth, req)
            return Response(wav, media_type="audio/wav")

        return api
