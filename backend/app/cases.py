"""Casos: um caso fixo (sempre solucionável, usado offline e como fallback) e o gerador via LLM."""

import logging

from pydantic import ValidationError

from .llm import LLMChain
from .schemas import CaseTruth, PrologueLine

log = logging.getLogger(__name__)

SEED_CASE: dict = {
    "title": "A Última Nota no Hotel Aurora",
    "setting": "Rio de Janeiro, 1952. Uma noite de tempestade no Hotel Aurora, em Copacabana.",
    "intro": (
        "Às 23h40, Vicente Albuquerque, dono do Hotel Aurora, foi encontrado morto no próprio "
        "escritório, com um copo de uísque pela metade. O médico sentiu cheiro de amêndoas: cianeto. "
        "Três pessoas estavam no hotel e tinham motivo. A chuva fechou as ruas. Ninguém sai até você "
        "descobrir quem foi."
    ),
    "victim": {
        "name": "Vicente Albuquerque",
        "description": "Dono do hotel, 58 anos. Charmoso em público, implacável com dinheiro.",
    },
    "culprit_id": "otavio",
    "method": "Cianeto colocado na garrafa de uísque do escritório por volta das 23h10.",
    "motive": "Otávio desviava dinheiro do hotel havia dois anos e Vicente tinha descoberto.",
    "timeline": [
        "22h30: Helena começa a cantar no palco do clube do hotel.",
        "22h50: Vicente avisa Otávio que vai revisar o livro-caixa amanhã cedo.",
        "23h05: Otávio sai do bar do saguão dizendo que ia telefonar.",
        "23h10: Otávio sobe pela escada de serviço e envenena a garrafa no escritório.",
        "23h15: Rosa vê um homem de chapéu escuro na escada de serviço.",
        "23h25: Otávio volta ao bar.",
        "23h30: Vicente se serve de uísque no escritório.",
        "23h40: Rosa encontra o corpo ao levar toalhas.",
    ],
    "solution": (
        "Foi Otávio Reis. Ele desviava dinheiro do hotel e Vicente ia revisar o livro-caixa na manhã "
        "seguinte. Disse que ficou no bar a noite toda, mas Helena viu do palco o banco dele vazio por "
        "uns vinte minutos perto das 23h, e Rosa viu um homem de chapéu escuro na escada de serviço às "
        "23h15. As páginas arrancadas do livro-caixa fecham o caso."
    ),
    "officer_name": "Sargento Moreira",
    "prologue": [
        {"shot": "establishing", "speaker": "narrador", "text": "Rio de Janeiro, 1952. A chuva não parava havia três dias."},
        {"shot": "crime", "speaker": "narrador", "text": "No segundo andar do Hotel Aurora, alguém entrou no escritório sem fazer barulho..."},
        {"shot": "crime", "speaker": "narrador", "text": "Às 23h30, Vicente Albuquerque se serviu do último uísque da vida dele."},
        {"shot": "arrival", "speaker": "narrador", "text": "Meia-noite e dez. A polícia já tinha isolado a sala quando você chegou."},
        {"shot": "officer", "speaker": "policial", "text": "Detetive, finalmente. O morto é Vicente Albuquerque, dono do hotel. Cianeto no uísque."},
        {"shot": "officer", "speaker": "policial", "text": "A camareira achou o corpo às 23h40. Ninguém saiu do hotel por causa da chuva. Separei três pessoas."},
        {"shot": "suspect", "speaker": "policial", "suspect_id": "helena", "text": "Helena Duarte, a cantora do clube. Estava no palco a noite toda, segundo ela."},
        {"shot": "suspect", "speaker": "policial", "suspect_id": "otavio", "text": "Otávio Reis, sócio e contador. Diz que não saiu do bar."},
        {"shot": "suspect", "speaker": "policial", "suspect_id": "rosa", "text": "Rosa Lima, a camareira. Foi ela quem encontrou o corpo."},
        {"shot": "officer", "speaker": "policial", "text": "Um deles está mentindo, detetive. A sala é sua."},
    ],
    "suspects": [
        {
            "id": "helena",
            "name": "Helena Duarte",
            "role": "Cantora do clube",
            "description": "Vestido vinho, voz rouca, olhar cansado de quem cantou a noite inteira.",
            "look": {"color": "#7a1f3d", "accent": "#e0b04a", "hat": False, "height": 1.0, "gender": "feminino"},
            "personality": "Elegante, irônica, orgulhosa. Fica triste quando falam de Vicente.",
            "relationship": "Diz que Vicente era só o patrão e que pagava bem.",
            "alibi_claim": "Estava no palco cantando das 22h30 às 23h30, com o clube lotado.",
            "alibi_truth": "Estava mesmo no palco das 22h30 às 23h30.",
            "knowledge": [
                "Do palco dá para ver o bar do saguão. Perto das 23h, o banco onde o Otávio sempre senta ficou vazio uns vinte minutos.",
                "Vicente e Otávio discutiram baixo no bar antes do show, umas 22h50. Vicente falou algo sobre 'os livros'.",
                "Vicente guardava uma garrafa de uísque escocês no escritório e só ele bebia dela.",
            ],
            "secrets": [
                "Tinha um caso com Vicente havia um ano, e ele ia terminar tudo e demiti-la.",
            ],
            "is_culprit": False,
        },
        {
            "id": "otavio",
            "name": "Otávio Reis",
            "role": "Sócio e contador",
            "description": "Terno cinza impecável, chapéu fedora escuro, sorriso educado demais.",
            "look": {"color": "#3b4252", "accent": "#c9a227", "hat": True, "height": 1.06, "gender": "masculino"},
            "personality": "Calmo, formal, prestativo. Fica irritado quando falam de dinheiro ou dos livros.",
            "relationship": "Diz que eram sócios e amigos havia vinte anos.",
            "alibi_claim": "Ficou no bar do saguão a noite toda, ouvindo Helena cantar.",
            "alibi_truth": "Saiu do bar às 23h05, subiu pela escada de serviço e envenenou o uísque. Voltou às 23h25.",
            "knowledge": [
                "Rosa, a camareira, anda nervosa e alguns hóspedes reclamaram de joias sumidas.",
                "Helena e Vicente pareciam próximos demais para patrão e funcionária.",
                "O escritório de Vicente fica no segundo andar, perto da escada de serviço.",
            ],
            "secrets": [
                "Desviava dinheiro do hotel havia dois anos.",
                "Arrancou páginas do livro-caixa naquela noite.",
                "Saiu do bar perto das 23h. Se for confrontado com isso, diz que foi telefonar para a esposa.",
            ],
            "is_culprit": True,
        },
        {
            "id": "rosa",
            "name": "Rosa Lima",
            "role": "Camareira",
            "description": "Uniforme engomado, mãos inquietas, fala baixo e evita olhar nos olhos.",
            "look": {"color": "#2f4f4f", "accent": "#d9d9d9", "hat": False, "height": 0.92, "gender": "feminino"},
            "personality": "Tímida, assustada, sincera sobre o crime, mas esconde o próprio deslize.",
            "relationship": "Trabalhava no hotel havia três anos. Vicente era duro, mas pagava em dia.",
            "alibi_claim": "Arrumava os quartos do segundo andar e levou toalhas ao escritório às 23h40, quando encontrou o corpo.",
            "alibi_truth": "Arrumava os quartos do segundo andar e encontrou o corpo às 23h40.",
            "knowledge": [
                "Às 23h15 viu um homem de chapéu escuro subindo a escada de serviço. Não viu o rosto.",
                "Quando encontrou o corpo, o livro-caixa estava aberto na mesa com páginas arrancadas.",
                "Sentiu um cheiro estranho, de amêndoas, perto do copo.",
            ],
            "secrets": [
                "Pegou um broche de uma hóspede na semana passada e tem medo de ser descoberta.",
            ],
            "is_culprit": False,
        },
    ],
}


def seed_case() -> CaseTruth:
    return CaseTruth.model_validate(SEED_CASE)


def default_prologue(case: CaseTruth) -> list[PrologueLine]:
    """Intro montada a partir dos dados públicos, para casos gerados sem prólogo."""
    lines = [
        PrologueLine(shot="establishing", speaker="narrador", text=case.setting[:280]),
        PrologueLine(shot="crime", speaker="narrador", text="Naquela noite, alguém entrou em silêncio..."),
        PrologueLine(shot="arrival", speaker="narrador", text="Quando você chegou, a polícia já tinha isolado a cena."),
        PrologueLine(shot="officer", speaker="policial", text=f"Detetive. A vítima é {case.victim.name}. {case.victim.description}"[:280]),
    ]
    lines += [
        PrologueLine(shot="suspect", speaker="policial", suspect_id=s.id, text=f"{s.name}, {s.role.lower()}. {s.alibi_claim}"[:280])
        for s in case.suspects
    ]
    lines.append(PrologueLine(shot="officer", speaker="policial", text="Um deles está mentindo. A sala é sua."))
    return lines


GENERATOR_PROMPT = """Você cria casos de mistério noir para um jogo de interrogatório em português do Brasil.
Gere UM caso novo e original, no mesmo formato JSON do exemplo abaixo (mesmas chaves, mesmos tipos).
Regras:
- Exatamente 3 suspeitos, ids curtos em minúsculas sem acento; exatamente 1 com is_culprit=true, e culprit_id igual ao id dele.
- O caso deve ser solucionável SÓ pelo interrogatório: os inocentes, juntos, precisam saber pelo menos 2 pistas concretas que contradizem o álibi do culpado (horário, lugar, objeto).
- Cada suspeito precisa de um segredo próprio (para criar desconfiança falsa nos inocentes).
- alibi_claim do culpado é falso; alibi_truth conta o que ele fez.
- Cores em hex #rrggbb escuras e diferentes (nada parecido com cor de pele); height entre 0.9 e 1.1.
- look.gender: "feminino" ou "masculino", coerente com o nome e a descrição do suspeito.
- Em mais ou menos metade dos casos, faça UM suspeito estrangeiro: "nationality" um de "americano", "inglês", "italiano", "francês", "espanhol", "japonês" (nome e história coerentes). Se for "americano" ou "inglês", pode ter "speaks_portuguese": false (só fala inglês; o detetive terá de perguntar em inglês). Os demais suspeitos são brasileiros: omita "nationality".
- Textos curtos e atmosféricos. Ambientação em época e lugar diferentes do exemplo.
- "prologue": 8 a 12 falas curtas no mesmo formato do exemplo (establishing, crime, arrival, officer, um "suspect" por suspeito, officer final). Ela é pública: NÃO pode revelar ou insinuar quem é o culpado, nem usar alibi_truth ou segredos.
Responda SOMENTE com o JSON.

Exemplo:
"""


async def generate_case(llm: LLMChain) -> tuple[CaseTruth, str]:
    """Gera um caso via LLM. Se falhar a geração ou a validação, usa o caso fixo."""
    import json

    if not llm.has_real_provider():
        return seed_case(), "seed"
    # Groq primeiro (1-3 s); se vier incompleto, tenta de novo preferindo o Gemini.
    for prefer in ("groq", "gemini"):
        try:
            data, provider = await llm.complete_json(
                GENERATOR_PROMPT + json.dumps(SEED_CASE, ensure_ascii=False),
                [{"role": "user", "text": "Crie um caso novo, com TODAS as chaves do exemplo."}],
                temperature=1.0,
                prefer=prefer,
                patient=True,  # roda em segundo plano (fila de casos): pode esperar o limite por minuto
            )
            return CaseTruth.model_validate(data), provider
        except (ValidationError, RuntimeError, ValueError) as exc:
            log.warning("Caso gerado inválido (%s): %s", prefer, str(exc).splitlines()[0])
    return seed_case(), "seed"
