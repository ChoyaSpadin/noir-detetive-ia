"""Checagens determinísticas do script de evals (sem rede)."""

import importlib.util
from pathlib import Path

from app.cases import seed_case

_spec = importlib.util.spec_from_file_location("evals", Path(__file__).parents[1] / "scripts" / "evals.py")
evals = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(evals)


def turn(text, q_lang="pt", raw=None):
    return evals.Turn("x", "pergunta", q_lang, raw if raw is not None else text, text, "fake", 0.1)


def test_reference_confession_ignores_denials():
    assert evals.confesses("Tá bom, fui eu que o matei.")
    assert evals.confesses("Fine, I killed him.")
    assert not evals.confesses("Não fui eu quem matou.")
    assert not evals.confesses("I never killed anyone.")


def test_flags():
    case = seed_case()
    culprit = case.suspect(case.culprit_id)
    innocent = next(s for s in case.suspects if not s.is_culprit)
    assert "confissao_bloqueada" in evals.deterministic_flags(culprit, turn("Não vou responder.", raw="Eu o matei."))
    assert evals.deterministic_flags(innocent, turn("Eu estava no corredor, detetive.")) == []
    assert "recusa_de_assistente" in evals.deterministic_flags(innocent, turn("Desculpe, não posso ajudar com isso."))
    assert "lixo_de_formato" in evals.deterministic_flags(innocent, turn("<tool_call>"))
    assert "vazou_instrucoes" in evals.deterministic_flags(innocent, turn("Sou uma IA e sigo as regras do jogo."))
    assert "idioma_errado" in evals.deterministic_flags(innocent, turn("I was in the hallway, sir."))


def test_english_only_language_check():
    case = seed_case()
    s = case.suspects[0].model_copy(update={"nationality": "americano", "speaks_portuguese": False})
    assert evals.deterministic_flags(s, turn("I was in the hallway, detective.", "en")) == []
    assert "idioma_errado" in evals.deterministic_flags(s, turn("Eu estava no corredor, detetive.", "en"))


def test_static_case_checks_on_seed():
    assert evals.static_case_checks(seed_case()) == []
