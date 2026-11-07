# CONTEXT — Noir: Detetive IA

Jogo de mistério 3D mobile-first: o jogador interroga 3 suspeitos (agentes LLM) e acusa o culpado. Projeto de portfólio (vagas remotas de IA aplicada), 100% em planos grátis.

## Stack
- frontend/: Vite 8 + React 19 + TS + three 0.187 + @react-three/fiber 9 + drei 10 + postprocessing. CSS puro (src/index.css).
- backend/: Python 3.12 + FastAPI + Pydantic 2 + httpx. LLM: Gemini (principal) -> Groq (reserva) -> modo offline por regras.

## Mapa
- backend/app/schemas.py: CaseTruth (verdade, nunca vai ao cliente) e modelos Public*/requests.
- backend/app/cases.py: SEED_CASE (Hotel Aurora, culpado "otavio") + generate_case (LLM, valida, fallback no seed).
- backend/app/agents.py: prompt por suspeito (só o que ele sabe), filtro de confissão, offline_answer.
- backend/app/llm.py: GeminiProvider, GroqProvider, LLMChain (fallback), build_chain_from_env.
- backend/app/kokoro_voice.py: voz local ilimitada (Kokoro-82M fp32 ONNX em backend/models, fora do git; ~tempo real em CPU). TODOS os suspeitos falam: brasileiros com pm_alex/pm_santa/pf_dora (variando voz/velocidade por slot), estrangeiros com sotaque (nationality) e speaks_portuguese=false = só inglês. Fala gerada frase a frase (split_sentences em main.py, corta em vírgula se >70 chars) -> audio_urls; respostas do jogo têm prioridade sobre trabalho de fundo. Também é a reserva da intro quando o Google está sem cota.
- backend/app/store.py: sessões em memória (TTL 6h, máx 500).
- backend/app/tts.py: voz neural da intro em UMA chamada por caso (Gemini TTS multi-falante, cada fala uma part com speechMetadata.speaker: Narrador=Charon, Sargento=Algenib; sem instrução de estilo). Cota grátis: 10 chamadas/dia por modelo (flash + lite) = ~20 intros/dia. O áudio é cortado por fala em audio_split.py: Whisper do Groq (palavras com tempo, erro ~0,1 s) e, sem ele, programação dinâmica nas pausas. Cache por fala em backend/.tts-cache; no 429 pausa o modelo pelo retryDelay. Sem voz = só legenda.
- backend/app/main.py: rotas + CasePool (CASE_POOL=1 caso pronto em segundo plano, já pedindo as vozes; abrir caso < 1 s). Geração de caso usa Groq primeiro e espera retry-after no 429 (8k tokens/min). A fila só gera com o jogador parado há 60 s (POOL_QUIET_S) ou após acusar. Suspeitos: Groq primeiro, timeout 12 s.
- backend/tests/: test_game.py, test_audio_split.py, test_evals.py (54 testes).
- backend/scripts/evals.py: evals dos suspeitos (roteiro fixo pelo caminho do jogo + checagens determinísticas + juiz gpt-oss-120b + detetive de IA). Relatório em docs/evals.md (spoilers em <details>), bruto em backend/.evals/ (gitignored). Rodada ~30 min por causa da cota (juiz espaçado 20 s). Última (07/11): 97% limpas, 2/4 casos resolvidos pelo detetive. Guardas em agents.py vindas dos evals: confissão PT/EN com negação, recusa de assistente -> fala no personagem, filtro de <tool_call>, vazamento da verdade (culpado citar horário que só existe em alibi_truth e o detetive não disse -> TRUTH_DEFLECTION; também no stream de main.py, incluindo o flush). `--culpados N`: só culpados, relatório docs/evals-culpados.md (07/11: 0/87 vazamentos). Intro Google + corte Whisper testada de verdade em 06/11. Cota do Google salva em .tts-cache/quota.json.
- Modelos (nov/2026): texto gemini-3.8-flash (2.5 não existe mais p/ contas novas) e Groq openai/gpt-oss-120b (llama-3.3 saiu), com reservas qwen/qwen3.8-27b e openai/gpt-oss-20b (GROQ_FALLBACK_MODELS): cada modelo tem cota própria de 8k tokens/min, e no 429 o GroqProvider troca de modelo na hora.
- frontend/src/api.ts: contrato com o backend (manter igual a schemas.py).
- frontend/src/App.tsx: fases intro/playing/verdict e estado do chat.
- frontend/src/scene/: Scene (Canvas, pós, carregado com lazy), Room, Rain, Suspect, Officer, Silhouette, CameraRig, CutsceneCamera, sets/Street e sets/CrimeOffice (intro).
- frontend/src/scene/characters/Character.tsx: personagem Quaternius (CC0) com rig; "veste" o corpo base no carregamento (osso dominante -> pele/tecido, cores por vértice, suavização da roupa), prende cabelo/chapéu no osso Head, toca clipes do anims.glb e soma inclinação por emoção. outfits.ts: figurinos fixos + outfitFor() para casos gerados (corpo por look.gender do backend; sem ele, isFemale() pelo primeiro nome; clothColor() evita cor de pele). Suspect fica 0,2 à frente do encosto da cadeira.
- frontend/scripts/build-assets.mjs: converte os pacotes brutos (fora do repo, Desktop/noir) em public/models (188 MB -> 1,5 MB). Rodar: `node scripts/build-assets.mjs "C:/Users/choya/Desktop/noir"`.
- frontend/lab.html + src/lab.tsx: página de teste dos personagens (só dev), ?clip=Nome.
- frontend/src/ui/CutsceneOverlay.tsx + src/audio/ (chuva/trovão Web Audio; voz neural com fallback). Volume mestre + mudo em audio/ambience.ts (localStorage noir-volume/noir-muted, onSoundChange). ui/SoundControl.tsx: sempre visível (flutuante na intro/briefing/veredito, dentro do HUD e da cutscene).
- frontend/src/ui/: IntroScreen, HUD, SuspectTabs, ChatSheet, AccuseModal, VerdictScreen.

## Contrato da API
- POST /api/cases -> PublicCase (suspects[].look.gender feminino|masculino; inclui prologue[{shot, speaker, text, suspect_id}] e officer_name; prólogo validado para não revelar o culpado)
- POST /api/cases/{id}/interrogate/stream (SSE, usado pelo jogo): emotion -> piece{text,audio_url}... -> done. Groq em streaming (texto livre: 1ª linha emoção), Chunker em main.py (trechos crescentes: <=28, <=42, <=75, <=110 chars; o Kokoro leva ~0,3 s + 0,035 s/char, então a voz começa em ~1,5 s e o próximo trecho fica pronto antes do anterior acabar; a resposta segura a prioridade do Kokoro inteira via kokoro.hold, e a intro em fundo é gerada frase por frase) e voz Kokoro por trecho em ordem. Front: audio/speechQueue.ts digita cada trecho durante a voz dele (sem voz: 32 chars/s).
- Pergunta por voz: ui/MicButton.tsx + audio/recorder.ts (segurar = fala; toque = liga/desliga) -> POST /api/cases/{id}/transcribe (Whisper large-v3 do Groq, ~0,6 s; idioma ESCOLHIDO pelo jogador no botão PT/EN ao lado do microfone, que começa em EN para quem só fala inglês: não dá para adivinhar, a detecção erra e forçar o idioma errado TRADUZ com confiança quase igual; SEM prompt: com silêncio o Whisper repetia a dica, ex. os nomes; filtra lixo tipo "Thank you"; última gravação salva em backend/.tts-cache/mic/ para diagnóstico). Captura crua (echoCancellation/noiseSuppression desligados: zeravam a voz com a chuva tocando) e o som ambiente cala ao gravar (duckAmbience). O botão mede o volume (anel cresce com a voz) e não envia se não captou nada. Perguntas prontas (chips) foram removidas. O texto cai no campo para revisar antes de enviar. Microfone só em HTTPS/localhost.
- POST /api/cases/{id}/interrogate {suspect_id, question<=300} (versão inteira, sem streaming) -> {answer, emotion, questions_left, provider}; 400/404/409/429/503
- POST /api/cases/{id}/accuse {suspect_id, reasoning} -> {correct, culprit_id, culprit_name, explanation}; encerra o caso
- GET /api/cases/{id}/prologue/{n}/audio -> audio/wav (503 sem voz: front usa a do navegador)
- GET /api/health

## Rodar
- backend: `python -m uvicorn app.main:app --app-dir backend --port 8000` (chaves em backend/.env, ver .env.example)
- frontend: `npm --prefix frontend run dev` (proxy /api -> :8000, host liberado para celular)

## Estado (2026-11-05)
- MVP + intro animada (rua, crime com silhueta, chegada, sargento, apresentação dos suspeitos) + personagens reais animados. Testado no navegador do app em modo offline. Não testado com chaves reais nem em celular físico.
- Bundle inicial 76 kB gzip; cena 3D 344 kB gzip + modelos 1,5 MB.
- Limitações: roupa é pintura sobre o corpo base (sem saia/paletó com volume); no navegador do app a cena demora ~20 s (compilação de shader), montagem do personagem leva 30-60 ms.
- Workaround em Character.tsx: proteção global em SkinnedMesh.computeBoundingSphere (alguma malha com osso inválido travava o frame; causa raiz não achada).

## Próximos passos
- Testar com chaves reais e no celular; medir FPS.
- Roupas com volume (paletó/saia como malhas presas aos ossos) e mais animações por emoção.
- Evals: detetive de IA fraco (2/4); juiz falta cota em rodadas longas. Limite por IP, métricas de jogo.
- Idiomas: selo de estrangeiro (ui/language.ts foreignBadge) nas abas, dossiê, cutscene e chat. Estrangeiro com sotaque entende pouco português e bem inglês (responde em inglês se perguntado em inglês). A voz de cada trecho escolhe en/pt por agents.speech_language (texto do trecho; curto segue a pergunta).
- Deploy NO AR (6/11/2026): site https://noir-detetive-ia.onrender.com, API https://noir-detetive-ia-api.onrender.com (Blueprint render.yaml, repo PÚBLICO github.com/ChoyaSpadin/noir-detetive-ia (README com GIF em docs/, prévia og.jpg, cache de assets/modelos no render.yaml), auto-deploy do main; chaves só no painel do Render). Arquitetura: site estático (Vite) + API no Render grátis (render.yaml, requirements-server.txt, sem Kokoro, CASE_POOL=0) + voz no Modal Starter (deploy/modal_voice.py, US$ 1/mês com teto, max 1 container, chave X-Voice-Key; backend usa RemoteKokoro quando KOKORO_URL existe; se falhar, desliga a voz 10 min e segue só texto). Voz PUBLICADA no Modal: https://projetosspadin--noir-voz-voz-web.us-east.modal.run (us-east; ONNX com 2 threads fixas: 110 letras em 3,5 s; ~1,3 s fixos por pedido; frio ~8 s). Chave em backend/.env KOKORO_KEY e no secret noir-voz do Modal. Local usa Kokoro do PC; para usar o Modal, rodar com KOKORO_URL.
- Arquivo de casos: backend/scripts/build_library.py gera casos validados + intro em MP3 (backend/app/library/{cases,audio}); dados públicos em frontend/src/data/caseLibrary.json. Tela inicial = ui/CaseArchive.tsx (pastas + "caso inédito"); App acorda o servidor (/api/health) ao abrir. POST /api/cases aceita {library_id}. 4 casos (Trem da Baía, Hotel Aurora, Sussurro dos Cabos c/ americano com sotaque culpado, Som Morto na Vela c/ americano só-inglês inocente). Falta: narrar com Gemini (saiu Kokoro), mais casos variados.

