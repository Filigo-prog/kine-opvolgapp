#!/usr/bin/env python3
"""Protocollen van de app naar Excel en terug.

  protocollen export                     maakt local/protocollen.xlsx uit data/protocol-*.json
  protocollen import                     toont wat je in Excel veranderd hebt (verandert niets)
  protocollen import --toepassen         voert die wijzigingen door in de protocolbestanden

De JSON-bestanden blijven de bron. Het Excel-bestand is een invulblad: enkel de gele cellen worden
teruggelezen. Bij het exporteren wordt een kopie van de waarden bewaard in een verborgen blad. Bij het
importeren telt alleen wat jij ten opzichte van die kopie veranderd hebt, en wordt alles geweigerd als het
protocol intussen op dezelfde plek anders is geworden. Bij het toepassen worden de versie van het protocol
en de cacheversie van de app (sw.js) verhoogd, zodat de iPad de wijziging ook echt ophaalt.
"""

import argparse
import datetime
import json
import re
import sys
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill, Protection
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = Path(__file__).resolve().parent.parent
PROTOCOLS = ("vkb", "enkel")
SNAPSHOT_SHEET = "_origineel"
FONT = "Arial"
PLACEHOLDERS = ("threshold", "weeks", "months", "perWeek")

TEAL = "1F6F6B"
FILL_HEADER = PatternFill("solid", fgColor=TEAL)
FILL_LOCKED = PatternFill("solid", fgColor="EEF2F0")
FILL_EDIT = PatternFill("solid", fgColor="FFF6D6")
FILL_NA = PatternFill("solid", fgColor="D9DEDC")


class ProtocolError(Exception):
    """Een fout die de gebruiker moet kunnen lezen."""


# --------------------------------------------------------------------------------------------
# Waarden normaliseren en controleren
# --------------------------------------------------------------------------------------------

def norm_text(value):
    return "" if value is None else str(value).strip()


def norm_number(value):
    """Cel of JSON-waarde → int, float of None. Tekst met komma ('2,5') wordt ook gelezen."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if isinstance(value, bool):
        raise ValueError("geen getal")
    if isinstance(value, str):
        value = float(value.strip().replace(",", "."))
    return int(value) if float(value).is_integer() else float(value)


def norm_lines(value):
    if isinstance(value, list):
        value = "\n".join(value)
    return "\n".join(line.strip() for line in norm_text(value).replace("\r", "").split("\n") if line.strip())


def norm(value, kind):
    if kind == "text":
        return norm_text(value)
    if kind in ("number", "int"):
        number = norm_number(value)
        if kind == "int" and number is not None and not float(number).is_integer():
            raise ValueError("geen geheel getal")
        return number
    if kind == "lines":
        return norm_lines(value)
    return value  # 'moments' wordt apart behandeld


def in_range(low, high, unit=""):
    def check(value):
        if value is None:
            return "mag niet leeg zijn"
        if not (low <= value <= high):
            return f"moet tussen {low} en {high}{unit} liggen"
        return None
    return check


def required(value):
    return "mag niet leeg zijn" if value in ("", None) else None


# --------------------------------------------------------------------------------------------
# Velden: één bewerkbare waarde in een protocol
# --------------------------------------------------------------------------------------------

class Field:
    def __init__(self, key, where, header, kind, get, set_, check=None, optional=False):
        self.key, self.where, self.header, self.kind = key, where, header, kind
        self._get, self._set, self.check, self.optional = get, set_, check, optional

    def get(self, protocols):
        return norm(self._get(protocols), self.kind)

    def set(self, protocols, value):
        self._set(protocols, value)

    def describe(self):
        return f"{self.where} · {self.header}"


def attr_field(key, where, header, kind, locate, attr, check=None, optional=False):
    """Veld dat een eigenschap van een object in het protocol is. locate(protocols) geeft dat object."""
    def get(P):
        value = locate(P).get(attr)
        return "\n".join(value) if kind == "lines" and isinstance(value, list) else value

    def set_(P, value):
        target = locate(P)
        if kind == "lines":
            target[attr] = [line for line in value.split("\n") if line]
        elif value in (None, "") and optional:
            target.pop(attr, None)
        else:
            target[attr] = value

    return Field(key, where, header, kind, get, set_, check, optional)


def by_id(items, field, value):
    for item in items:
        if str(item.get(field)) == str(value):
            return item
    raise ProtocolError(f"'{value}' staat niet (meer) in het protocol.")


# --------------------------------------------------------------------------------------------
# Het werkboek opbouwen: bladen met kolommen en rijen
# --------------------------------------------------------------------------------------------

class Sheet:
    def __init__(self, name, tab, columns, id_cols, intro):
        self.name, self.tab, self.columns, self.id_cols, self.intro = name, tab, columns, id_cols, intro
        self.rows = []  # lijst van dicts: header -> ('L', waarde) | ('E', Field) | ('N', '') | ('F', formule)


# kolombreedtes: (header, breedte)
def criterion_unit(criterion, test_by_id):
    if criterion["type"] == "minTime":
        return "weken" if "weeks" in criterion else "maanden"
    if criterion["type"] != "measurement":
        return ""
    if criterion.get("metric") in ("lsi", "asymmetry", "baselinePct"):
        return "%"
    test = test_by_id.get(criterion.get("test") or (criterion.get("tests") or [""])[0], {})
    return test.get("unit", "")


METRIC_LABELS = {"lsi": "LSI", "difference": "verschil", "injured": "aangedane zijde", "value": "waarde",
                 "asymmetry": "asymmetrie", "baselinePct": "% van baseline"}


def check_evidence(value):
    """Evidentieniveau A tot D, of een combinatie zoals B/C; leeg mag."""
    if value in (None, ""):
        return None
    return None if re.fullmatch(r"[A-D](/[A-D])?", str(value)) else "moet A, B, C of D zijn (of een combinatie zoals B/C)"
TYPE_LABELS = {"measurement": "meting", "minTime": "minimumtermijn", "judgement": "jouw oordeel"}


def build_sheets(P):
    sheets = {}

    # ---- Testschema ----
    sc = Sheet("Testschema", "2E7D4F", [("Protocol", 11), ("Week van", 11), ("Week tot (optioneel)", 16), ("Omschrijving", 52)],
               ["Protocol"], "Wanneer wordt er getest? De weken tellen vanaf de operatie of het letsel. "
                             "Vul onderaan een nieuwe rij in om een testmoment toe te voegen; wis een rij leeg om het te schrappen. De weken moeten oplopen.")
    sheets[sc.name] = sc

    # ---- Referenties ----
    rf = Sheet("Referenties", "2E7D4F", [("Protocol", 11), ("ID", 22), ("Groep", 24), ("Test", 44), ("Referentie (voor iedereen)", 30),
                                         ("Referentie mannen", 22), ("Referentie vrouwen", 22), ("Gekoppeld aan app-test", 22)],
               ["Protocol", "ID"], "Referentiewaarden (cutoffs) uit je testlijst. Vul een cel in, wijzig of wis ze. "
                                   "Staat er iets bij 'mannen' of 'vrouwen', dan toont de app de juiste waarde voor het geslacht van de patiënt.")
    sheets[rf.name] = rf

    # ---- Criteria ----
    cr = Sheet("Criteria", "1F6F6B", [("Protocol", 11), ("Level", 8), ("ID", 20), ("Omschrijving", 52), ("Zo ziet het eruit", 52), ("Tekst voor de patiënt", 44),
                                      ("Type", 15), ("Test", 30), ("Meetwaarde", 16), ("Vergelijking", 12), ("Grens", 10), ("Eenheid", 10), ("Niveau (A–D)", 12),
                                      ("Bij niet halen", 52), ("Notitie", 40)],
               ["Protocol", "ID"], "De criteria om naar het volgende level te gaan. Pas de gele cel 'Grens' aan; schrijf {threshold} in de omschrijving "
                                   "waar de grens moet verschijnen ({weeks} of {months} bij een minimumtermijn). 'Zo ziet het eruit' rekent dat meteen voor je uit. "
                                   "'Niveau' is het evidentieniveau (A tot D) van de grens; 'Bij niet halen' is wat je doet als het criterium niet gehaald wordt.")
    sheets[cr.name] = cr

    # ---- Levels ----
    lv = Sheet("Levels", "1F6F6B", [("Protocol", 11), ("Level", 8), ("Titel", 30), ("Korte titel", 18), ("Ondertitel", 30), ("Doel voor de patiënt", 50), ("Focus (voor jou)", 50),
                                    ("Wat doen we nu? (patiënt, één regel per zin)", 60)],
               ["Protocol", "Level"], "De titels en teksten per level. In de laatste kolom zet je elke zin op een nieuwe regel (Alt+Enter in Excel).")
    sheets[lv.name] = lv

    # ---- Tests ----
    ts = Sheet("Tests", "1F6F6B", [("Protocol", 11), ("ID", 16), ("Test", 40), ("Eenheid", 10), ("Min", 9), ("Max", 9), ("Doelzone (%)", 13),
                                   ("Titel voor de patiënt", 34), ("In een zin (patiënt)", 38)],
               ["Protocol", "ID", "Eenheid"], "Het toegelaten bereik van elke meting (een waarde buiten min en max wordt geweigerd) en de doelzone van de grafiek.")
    sheets[ts.name] = ts

    # ---- Mijlpalen ----
    ml = Sheet("Mijlpalen", "1F6F6B", [("Protocol", 11), ("ID", 18), ("Soort", 14), ("Naam", 30), ("Uitleg voor de patiënt", 56), ("Grens", 10), ("Dagen per week", 15)],
               ["Protocol", "ID"], "De mijlpalen. Bij 'kracht' is de grens een LSI in %, bij 'oefenreeks' het aantal weken. Gebruik {threshold}, {weeks} of {perWeek} in de tekst.")
    sheets[ml.name] = ml

    # ---- Stopregels ----
    sr = Sheet("Stopregels", "1F6F6B", [("Protocol", 11), ("Nr", 6), ("Bevinding", 52), ("Actie", 60)],
               ["Protocol", "Nr"], "De stop- en regressieregels: wat doe je bij een bevinding, ongeacht de fase. Je kan de tekst aanpassen; regels toevoegen of schrappen kan via Claude.")
    sheets[sr.name] = sr

    # ---- Instellingen ----
    st = Sheet("Instellingen", "1F6F6B", [("Protocol", 11), ("Instelling", 38), ("Waarde", 50), ("Uitleg", 60)],
               ["Protocol", "Instelling"], "Overige instellingen.")
    sheets[st.name] = st

    for proto in PROTOCOLS:
        d = P[proto]
        tests = [t for g in d.get("testGroups", []) for t in g["tests"]]
        test_by_id = {t["id"]: t for t in tests}
        label = proto.upper()

        # testschema (lijst) wordt apart ingelezen; hier enkel de regels voor het blad
        if "testSchedule" in d:
            sc.rows.append({"__protocol": proto})

        for ref in d.get("references", []):
            where = f"{label} · Referenties · {ref['id']}"
            loc = (lambda P, proto=proto, rid=ref["id"]: by_id(P[proto]["references"], "id", rid))
            key = lambda col, proto=proto, rid=ref["id"]: f"Referenties|{proto}|{rid}|{col}"
            rf.rows.append({
                "Protocol": ("L", proto), "ID": ("L", ref["id"]), "Groep": ("L", ref["group"]), "Test": ("L", ref["label"]),
                "Referentie (voor iedereen)": ("E", attr_field(key("Referentie (voor iedereen)"), where, "Referentie (voor iedereen)", "text", loc, "text", optional=True)),
                "Referentie mannen": ("E", attr_field(key("Referentie mannen"), where, "Referentie mannen", "text", loc, "men", optional=True)),
                "Referentie vrouwen": ("E", attr_field(key("Referentie vrouwen"), where, "Referentie vrouwen", "text", loc, "women", optional=True)),
                "Gekoppeld aan app-test": ("L", test_by_id.get(ref.get("testId"), {}).get("label", "")),
            })

        for level in d.get("levels", []):
            num = level["number"]
            lloc = (lambda P, proto=proto, num=num: by_id(P[proto]["levels"], "number", num))
            where = f"{label} · Level {num}"
            lk = lambda col, proto=proto, num=num: f"Levels|{proto}|{num}|{col}"
            lv.rows.append({
                "Protocol": ("L", proto), "Level": ("L", num),
                "Titel": ("E", attr_field(lk("Titel"), where, "Titel", "text", lloc, "title", required)),
                "Korte titel": ("E", attr_field(lk("Korte titel"), where, "Korte titel", "text", lloc, "shortTitle", optional=True)),
                "Ondertitel": ("E", attr_field(lk("Ondertitel"), where, "Ondertitel", "text", lloc, "subtitle", optional=True)),
                "Doel voor de patiënt": ("E", attr_field(lk("Doel voor de patiënt"), where, "Doel voor de patiënt", "text", lloc, "patientGoal", optional=True)),
                "Focus (voor jou)": ("E", attr_field(lk("Focus (voor jou)"), where, "Focus (voor jou)", "text", lloc, "focus", optional=True)),
                "Wat doen we nu? (patiënt, één regel per zin)": ("E", attr_field(lk("Wat doen we nu? (patiënt, één regel per zin)"), where, "Wat doen we nu?", "lines", lloc, "patientFocus", optional=True)),
            })
            for crit in level["criteria"]:
                cid = crit["id"]
                cloc = (lambda P, proto=proto, num=num, cid=cid: by_id(by_id(P[proto]["levels"], "number", num)["criteria"], "id", cid))
                ck = lambda col, proto=proto, cid=cid: f"Criteria|{proto}|{cid}|{col}"
                cwhere = f"{label} · Criterium {cid}"
                tests_text = ", ".join(test_by_id.get(t, {}).get("label", t) for t in (crit.get("tests") or ([crit["test"]] if "test" in crit else [])))
                row = {
                    "Protocol": ("L", proto), "Level": ("L", num), "ID": ("L", cid),
                    "Omschrijving": ("E", attr_field(ck("Omschrijving"), cwhere, "Omschrijving", "text", cloc, "label", required)),
                    "Zo ziet het eruit": ("F", None),
                    "Tekst voor de patiënt": ("E", attr_field(ck("Tekst voor de patiënt"), cwhere, "Tekst voor de patiënt", "text", cloc, "patientLabel", optional=True)),
                    "Type": ("L", TYPE_LABELS.get(crit["type"], crit["type"])),
                    "Test": ("L", tests_text),
                    "Meetwaarde": ("L", METRIC_LABELS.get(crit.get("metric"), "")),
                    "Vergelijking": ("L", {"in": "een van"}.get(crit.get("operator"), crit.get("operator", ""))),
                    "Eenheid": ("L", criterion_unit(crit, test_by_id)),
                    "Niveau (A–D)": ("E", attr_field(ck("Niveau (A–D)"), cwhere, "Niveau", "text", cloc, "evidence", check_evidence, optional=True)),
                    "Bij niet halen": ("E", attr_field(ck("Bij niet halen"), cwhere, "Bij niet halen", "text", cloc, "ifNotMet", optional=True)),
                    "Notitie": ("E", attr_field(ck("Notitie"), cwhere, "Notitie", "text", cloc, "note", optional=True)),
                }
                if crit["type"] == "minTime":
                    attr = "weeks" if "weeks" in crit else "months"
                    low_high = (1, 104) if attr == "weeks" else (1, 36)
                    row["Grens"] = ("E", attr_field(ck("Grens"), cwhere, "Grens", "int", cloc, attr, in_range(*low_high)))
                elif crit["type"] == "measurement" and isinstance(crit.get("threshold"), (int, float)):
                    check = in_range(0, 150, " %") if crit.get("metric") == "lsi" else in_range(-1000, 100000)
                    row["Grens"] = ("E", attr_field(ck("Grens"), cwhere, "Grens", "number", cloc, "threshold", check))
                else:
                    row["Grens"] = ("N", crit.get("values") and ", ".join(map(str, crit["values"])) or "")
                cr.rows.append(row)

        for test in tests:
            if test["type"] not in ("bilateral", "single"):
                continue
            tid = test["id"]
            units = test.get("units") or [{"unit": test.get("unit", ""), "min": test["min"], "max": test["max"]}]
            tloc = (lambda P, proto=proto, tid=tid: next(t for g in P[proto]["testGroups"] for t in g["tests"] if t["id"] == tid))
            for index, entry in enumerate(units):
                unit = entry["unit"]
                tk = lambda col, proto=proto, tid=tid, unit=unit: f"Tests|{proto}|{tid}|{unit}|{col}"
                twhere = f"{label} · Test {tid}" + (f" ({unit})" if test.get("units") else "")

                def uloc(P, tloc=tloc, unit=unit, has_units=bool(test.get("units"))):
                    t = tloc(P)
                    return next(u for u in t["units"] if u["unit"] == unit) if has_units else t

                def sync(P, value, attr, tloc=tloc, unit=unit, has_units=bool(test.get("units"))):
                    # test.min/max volgen de standaardeenheid
                    t = tloc(P)
                    if has_units and unit == t.get("unit"):
                        t[attr] = value

                def make(col, attr, tk=tk, twhere=twhere, uloc=uloc, sync=sync):
                    field = attr_field(tk(col), twhere, col, "number", uloc, attr, None)
                    original_set = field._set
                    field._set = lambda P, v, a=attr, o=original_set: (o(P, v), sync(P, v, a))
                    return field

                first = index == 0
                row = {
                    "Protocol": ("L", proto), "ID": ("L", tid), "Test": ("L", test["label"]), "Eenheid": ("L", unit),
                    "Min": ("E", make("Min", "min")), "Max": ("E", make("Max", "max")),
                }
                if first and test["type"] == "bilateral" and test.get("compare") in ("lsi", "lsi-inverse"):
                    row["Doelzone (%)"] = ("E", attr_field(tk("Doelzone (%)"), twhere, "Doelzone (%)", "number", tloc, "target", in_range(1, 150, " %"), optional=True))
                else:
                    row["Doelzone (%)"] = ("N", "")
                if first and "patientLabel" in test:
                    row["Titel voor de patiënt"] = ("E", attr_field(tk("Titel voor de patiënt"), twhere, "Titel voor de patiënt", "text", tloc, "patientLabel", optional=True))
                    row["In een zin (patiënt)"] = ("E", attr_field(tk("In een zin (patiënt)"), twhere, "In een zin (patiënt)", "text", tloc, "patientPhrase", optional=True))
                else:
                    row["Titel voor de patiënt"] = ("N", "")
                    row["In een zin (patiënt)"] = ("N", "")
                ts.rows.append(row)

        for ms in d.get("milestones", []):
            mid, trig = ms["id"], ms["trigger"]
            mloc = (lambda P, proto=proto, mid=mid: by_id(P[proto]["milestones"], "id", mid))
            mtrig = (lambda P, proto=proto, mid=mid: by_id(P[proto]["milestones"], "id", mid)["trigger"])
            mk = lambda col, proto=proto, mid=mid: f"Mijlpalen|{proto}|{mid}|{col}"
            mwhere = f"{label} · Mijlpaal {mid}"
            soort = {"criterion": "criterium", "lsi": "kracht (LSI)", "manual": "door jou", "completion": "afronding", "homeLogWeeks": "oefenreeks", "level": "level afgerond"}.get(trig["type"], trig["type"])
            row = {
                "Protocol": ("L", proto), "ID": ("L", mid), "Soort": ("L", soort),
                "Naam": ("E", attr_field(mk("Naam"), mwhere, "Naam", "text", mloc, "label", required)),
                "Uitleg voor de patiënt": ("E", attr_field(mk("Uitleg voor de patiënt"), mwhere, "Uitleg voor de patiënt", "text", mloc, "description", optional=True)),
                "Grens": ("N", ""), "Dagen per week": ("N", ""),
            }
            if trig["type"] == "lsi":
                row["Grens"] = ("E", attr_field(mk("Grens"), mwhere, "Grens", "number", mtrig, "threshold", in_range(0, 150, " %")))
            elif trig["type"] == "homeLogWeeks":
                row["Grens"] = ("E", attr_field(mk("Grens"), mwhere, "Grens (weken)", "int", mtrig, "weeks", in_range(1, 104)))
                row["Dagen per week"] = ("E", attr_field(mk("Dagen per week"), mwhere, "Dagen per week", "int", mtrig, "perWeek", in_range(1, 7)))
            ml.rows.append(row)

        for index, rule in enumerate(d.get("stopRules", [])):
            rloc = (lambda P, proto=proto, index=index: P[proto]["stopRules"][index])
            rk = lambda col, proto=proto, index=index: f"Stopregels|{proto}|{index + 1}|{col}"
            rwhere = f"{label} · Stopregel {index + 1}"
            sr.rows.append({
                "Protocol": ("L", proto), "Nr": ("L", index + 1),
                "Bevinding": ("E", attr_field(rk("Bevinding"), rwhere, "Bevinding", "text", rloc, "finding", required)),
                "Actie": ("E", attr_field(rk("Actie"), rwhere, "Actie", "text", rloc, "action", required)),
            })

        def setting(name, where_key, kind, locate, attr, check, explanation, proto=proto):
            sk = f"Instellingen|{proto}|{name}|Waarde"
            st.rows.append({
                "Protocol": ("L", proto), "Instelling": ("L", name),
                "Waarde": ("E", attr_field(sk, f"{proto.upper()} · {name}", "Waarde", kind, locate, attr, check)),
                "Uitleg": ("L", explanation),
            })

        if "homeLog" in d:
            setting("Rustdag-jokers per week", "homeLog", "int", lambda P, p=proto: P[p]["homeLog"], "jokersPerWeek", in_range(0, 3),
                    "Hoeveel losse gemiste dagen per week de streak vergeeft (0 tot 3).")
        if "testSchedule" in d:
            setting("Testschema: speling (weken)", "testSchedule", "int", lambda P, p=proto: P[p]["testSchedule"], "toleranceWeeks", in_range(0, 6),
                    "Een testmoment telt als gedaan met een meting tot zoveel weken voor of na de geplande periode.")
        if "prevention" in d:
            setting("Preventie: vanaf level", "prevention", "int", lambda P, p=proto: P[p]["prevention"], "fromLevel", in_range(1, len(d["levels"])),
                    "Vanaf dit level toont het thuislog 'Preventieschema'.")
            setting("Preventie: aantal weken", "prevention", "int", lambda P, p=proto: P[p]["prevention"], "weeks", in_range(1, 104),
                    "Voor de mijlpaal 'Preventiekampioen'.")
            setting("Preventie: dagen per week", "prevention", "int", lambda P, p=proto: P[p]["prevention"], "perWeek", in_range(1, 7),
                    "Minstens zoveel oefendagen per week.")
            setting("Preventie: titel", "prevention", "text", lambda P, p=proto: P[p]["prevention"], "title", required, "Titel boven het thuislog in de preventiefase.")
            setting("Preventie: tekst voor de patiënt", "prevention", "text", lambda P, p=proto: P[p]["prevention"], "patientText", required,
                    "Gebruik {perWeek} om het aantal dagen in te vullen.")
        if "completion" in d:
            setting("Groen licht: titel", "completion", "text", lambda P, p=proto: P[p]["completion"], "title", required, "Titel na de bevestiging van de return to sport.")
            setting("Groen licht: tekst voor de patiënt", "completion", "text", lambda P, p=proto: P[p]["completion"], "patientText", required,
                    "Wat de patiënt te zien krijgt na het groene licht.")
    return sheets


def moments_field(proto):
    def get(P):
        return [(m["week"], m.get("weekTo"), m["label"]) for m in P[proto]["testSchedule"]["moments"]]

    def set_(P, value):
        P[proto]["testSchedule"]["moments"] = [
            {"week": w, **({"weekTo": t} if t else {}), "label": label} for w, t, label in value]

    return Field(f"Testschema|{proto}|moments", f"{proto.upper()} · Testschema", "testmomenten", "moments", get, set_, check_moments)


def check_moments(value):
    previous = 0
    for week, week_to, label in value:
        if not label:
            return f"week {week}: de omschrijving mag niet leeg zijn"
        if week <= previous:
            return f"week {week}: de weken moeten oplopen (na week {previous})"
        if week_to is not None and week_to <= week:
            return f"week {week}: 'week tot' moet groter zijn dan 'week van'"
        previous = week
    return None if value else "het testschema mag niet leeg zijn"


# --------------------------------------------------------------------------------------------
# Lezen en schrijven van de protocolbestanden
# --------------------------------------------------------------------------------------------

def load_protocols(data_dir):
    protocols = {}
    for name in PROTOCOLS:
        path = Path(data_dir) / f"protocol-{name}.json"
        protocols[name] = json.loads(path.read_text(encoding="utf-8"))
    return protocols


def save_protocols(data_dir, protocols, only=None):
    for name in PROTOCOLS:
        if only is not None and name not in only:
            continue
        path = Path(data_dir) / f"protocol-{name}.json"
        path.write_text(json.dumps(protocols[name], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def collect(P, sheets):
    """Alle bewerkbare waarden: key → genormaliseerde waarde, en key → Field."""
    values, fields = {}, {}
    for sheet in sheets.values():
        for row in sheet.rows:
            for cell in row.values():
                if isinstance(cell, tuple) and cell[0] == "E":
                    values[cell[1].key] = cell[1].get(P)
                    fields[cell[1].key] = cell[1]
    for proto in PROTOCOLS:
        if "testSchedule" in P[proto]:
            field = moments_field(proto)
            values[field.key] = field.get(P)
            fields[field.key] = field
    return values, fields


# --------------------------------------------------------------------------------------------
# Excel schrijven
# --------------------------------------------------------------------------------------------

def style_cell(cell, fill=None, bold=False, color="000000", wrap=True, locked=True, align="top"):
    cell.font = Font(name=FONT, size=10, bold=bold, color=color)
    cell.alignment = Alignment(wrap_text=wrap, vertical=align)
    if fill:
        cell.fill = fill
    cell.protection = Protection(locked=locked)


def write_workbook(P, path, now=None):
    now = now or datetime.datetime.now()
    sheets = build_sheets(P)
    values, _fields = collect(P, sheets)
    wb = Workbook()

    # --- Leesmij ---
    ws = wb.active
    ws.title = "Leesmij"
    ws.sheet_properties.tabColor = "F2C14E"
    ws.column_dimensions["A"].width = 3
    ws.column_dimensions["B"].width = 120
    lines = [
        ("Protocollen van de kine-opvolgapp", "title"),
        (f"Gemaakt op {now:%d/%m/%Y om %H:%M}. Dit bestand hoort bij de huidige protocolbestanden; maak een nieuw als die ondertussen veranderd zijn.", "muted"),
        ("", None),
        ("Zo werkt het", "h"),
        ("1. Pas enkel de GELE cellen aan. Grijze cellen zijn vast en worden genegeerd. De bladen zijn beveiligd (zonder wachtwoord) zodat je er niet per ongeluk in typt.", None),
        ("2. Bewaar het bestand en zeg tegen Claude: \"verwerk mijn protocol\". Claude toont eerst wat er verandert, controleert het en voert het pas door na jouw akkoord.", None),
        ("3. Daarna zet Claude de wijziging online, na jouw akkoord. Open de app op je iPad één keer met internet en sluit hem weer: dan staat alles bij.", None),
        ("", None),
        ("Goed om te weten", "h"),
        ("• Een wijziging geldt meteen voor alle patiënten, ook voor wie al in een level zit. Afgevinkte criteria blijven wel staan.", None),
        ("• Schrijf {threshold} in een omschrijving waar de grens moet verschijnen ({weeks} of {months} bij een termijn, {perWeek} bij dagen per week). Verander je de grens, dan klopt de tekst vanzelf.", None),
        ("• Verander nooit de donkergroene titelrij, de naam van een blad of de kolom 'ID'. Daarmee herkent de tool welke rij waarbij hoort. Rijen verwijderen of van plaats wisselen is niet nodig en niet de bedoeling.", None),
        ("• Is het protocol ondertussen op dezelfde plek anders geworden, dan weigert de tool je wijziging en vraagt een nieuw bestand. Er gaat dus nooit iets stil verloren.", None),
        ("• Een lege gele cel bij een referentie of notitie betekent: niets tonen.", None),
        ("", None),
        ("Bladen", "h"),
        ("Testschema · Referenties (je testlijst met cutoffs) · Criteria (grenzen per level) · Levels · Tests (bereik en doelzone) · Mijlpalen · Instellingen", None),
        ("", None),
        ("Legende", "h"),
    ]
    for i, (text, style) in enumerate(lines, start=2):
        c = ws.cell(row=i, column=2, value=text)
        style_cell(c, bold=style in ("title", "h"), color={"title": TEAL, "muted": "55625E"}.get(style, "000000"))
        if style == "title":
            c.font = Font(name=FONT, size=16, bold=True, color=TEAL)
    row = len(lines) + 2
    for fill, text in ((FILL_EDIT, "Geel: hier mag je iets aanpassen."), (FILL_LOCKED, "Lichtgrijs: vast, niet aanpassen."), (FILL_NA, "Donkergrijs: hier is niets in te vullen.")):
        c = ws.cell(row=row, column=2, value=text)
        style_cell(c, fill=fill)
        row += 1
    ws.protection.sheet = True

    # --- gegevensbladen ---
    for sheet in sheets.values():
        ws = wb.create_sheet(sheet.name)
        ws.sheet_properties.tabColor = sheet.tab
        ws.cell(row=1, column=1, value=sheet.intro)
        style_cell(ws.cell(row=1, column=1), color="55625E", wrap=False)
        headers = [h for h, _ in sheet.columns]
        for col, (header, width) in enumerate(sheet.columns, start=1):
            ws.column_dimensions[get_column_letter(col)].width = width
            c = ws.cell(row=3, column=col, value=header)
            style_cell(c, fill=FILL_HEADER, bold=True, color="FFFFFF", locked=True, align="center")
        ws.freeze_panes = "A4"
        ws.row_dimensions[3].height = 30

        r = 4
        if sheet.name == "Testschema":
            for proto in PROTOCOLS:
                if "testSchedule" not in P[proto]:
                    continue
                moments = P[proto]["testSchedule"]["moments"]
                for m in moments + [None] * 12:
                    ws.cell(row=r, column=1, value=proto)
                    style_cell(ws.cell(row=r, column=1), fill=FILL_LOCKED)
                    for col, value in ((2, m and m["week"]), (3, m and m.get("weekTo")), (4, m and m["label"])):
                        c = ws.cell(row=r, column=col, value=value)
                        style_cell(c, fill=FILL_EDIT, locked=False)
                    r += 1
            dv = DataValidation(type="whole", operator="between", formula1="1", formula2="104", allow_blank=True,
                                errorTitle="Weken", error="Geef een geheel getal van 1 tot 104.")
            ws.add_data_validation(dv)
            dv.add(f"B4:C{max(r - 1, 4)}")
        else:
            id_headers = sheet.id_cols
            for rowdef in sheet.rows:
                for col, header in enumerate(headers, start=1):
                    kind, payload = rowdef.get(header, ("L", ""))
                    c = ws.cell(row=r, column=col)
                    if kind == "E":
                        value = payload.get(P)
                        c.value = value if value != "" else None
                        style_cell(c, fill=FILL_EDIT, locked=False)
                    elif kind == "F":
                        letter = get_column_letter(headers.index("Omschrijving") + 1)
                        grens = get_column_letter(headers.index("Grens") + 1)
                        c.value = (f'=SUBSTITUTE(SUBSTITUTE(SUBSTITUTE({letter}{r},"{{threshold}}",{grens}{r}),"{{weeks}}",{grens}{r}),"{{months}}",{grens}{r})')
                        style_cell(c, fill=FILL_LOCKED)
                    elif kind == "N":
                        c.value = payload or None
                        style_cell(c, fill=FILL_NA)
                    else:
                        c.value = payload
                        style_cell(c, fill=FILL_LOCKED)
                r += 1
            if sheet.rows:
                ws.auto_filter.ref = f"A3:{get_column_letter(len(headers))}{r - 1}"
        ws.protection.sheet = True
        ws.protection.autoFilter = False
        ws.protection.formatColumns = False
        ws.protection.formatRows = False
        if sheet.name == "Testschema":
            ws.protection.insertRows = False

    # --- verborgen kopie van de waarden bij het exporteren ---
    snap = wb.create_sheet(SNAPSHOT_SHEET)
    payload = json.dumps(values, ensure_ascii=False, separators=(",", ":"))
    snap.cell(row=1, column=1, value="Technische kopie van de waarden bij het exporteren. Niet aanpassen.")
    for i in range(0, len(payload), 20000):
        snap.cell(row=2 + i // 20000, column=1, value=payload[i:i + 20000])
    snap.sheet_state = "hidden"
    wb.save(path)
    return values


# --------------------------------------------------------------------------------------------
# Excel lezen en vergelijken
# --------------------------------------------------------------------------------------------

def read_snapshot(wb):
    if SNAPSHOT_SHEET not in wb.sheetnames:
        raise ProtocolError("Dit Excel-bestand komt niet van deze tool (het verborgen blad ontbreekt). Maak een nieuw bestand met 'export'.")
    ws = wb[SNAPSHOT_SHEET]
    text = "".join(str(ws.cell(row=r, column=1).value or "") for r in range(2, ws.max_row + 1))
    try:
        raw = json.loads(text)
    except json.JSONDecodeError:
        raise ProtocolError("De technische kopie in het Excel-bestand is beschadigd. Maak een nieuw bestand met 'export'.")
    # tuples komen als lijsten terug uit JSON
    return {k: ([tuple(x) for x in v] if isinstance(v, list) else v) for k, v in raw.items()}


def read_sheet_values(wb, P, sheets, fields):
    """Wat staat er nu in de gele cellen? key → (genormaliseerde waarde of Exception)."""
    values, problems = {}, []
    for sheet in sheets.values():
        if sheet.name not in wb.sheetnames:
            raise ProtocolError(f"Het blad '{sheet.name}' ontbreekt in het Excel-bestand.")
        ws = wb[sheet.name]
        headers = {ws.cell(row=3, column=c).value: c for c in range(1, ws.max_column + 1)}
        expected = [h for h, _ in sheet.columns]
        if [h for h in expected if h not in headers]:
            raise ProtocolError(f"Op het blad '{sheet.name}' is een kolomtitel veranderd of verwijderd. Maak een nieuw bestand met 'export'.")
        if sheet.name == "Testschema":
            for proto in PROTOCOLS:
                if "testSchedule" not in P[proto]:
                    continue
                moments = []
                for r in range(4, ws.max_row + 1):
                    if norm_text(ws.cell(row=r, column=headers["Protocol"]).value) != proto:
                        continue
                    week, to, label = (ws.cell(row=r, column=headers[h]).value for h in ("Week van", "Week tot (optioneel)", "Omschrijving"))
                    if week in (None, "") and to in (None, "") and norm_text(label) == "":
                        continue
                    try:
                        week_n, to_n = norm_number(week), norm_number(to)
                        if week_n is None or not float(week_n).is_integer() or (to_n is not None and not float(to_n).is_integer()):
                            raise ValueError
                    except ValueError:
                        problems.append(f"Testschema · rij {r}: 'week van' en 'week tot' moeten hele getallen zijn.")
                        continue
                    moments.append((int(week_n), int(to_n) if to_n is not None else None, norm_text(label)))
                values[f"Testschema|{proto}|moments"] = moments
            continue
        id_cols = sheet.id_cols
        for r in range(4, ws.max_row + 1):
            ids = [norm_text(ws.cell(row=r, column=headers[h]).value) for h in id_cols]
            if not all(ids):
                continue
            for header in [h for h, _ in sheet.columns]:
                key = f"{sheet.name}|{'|'.join(ids)}|{header}"
                if key not in fields:
                    continue
                field = fields[key]
                raw = ws.cell(row=r, column=headers[header]).value
                try:
                    values[key] = norm(raw, field.kind)
                except (ValueError, TypeError):
                    problems.append(f"{field.describe()} (rij {r}): '{raw}' is geen geldig getal.")
    return values, problems


def diff(P, wb, sheets, fields_now):
    """Vergelijk het Excel-bestand met de kopie bij het exporteren en met het huidige protocol."""
    snapshot = read_snapshot(wb)
    current, _ = collect(P, sheets)
    sheet_values, errors = read_sheet_values(wb, P, sheets, fields_now)
    changes, conflicts, warnings = [], [], []

    for key, new in sheet_values.items():
        if key not in snapshot:
            continue  # rij bestond niet bij het exporteren (bv. later toegevoegd aan het protocol)
        if new == snapshot[key]:
            continue
        field = fields_now[key]
        if key in current and new == current[key]:
            continue  # staat al zo in het protocol (bv. al eerder doorgevoerd)
        if key in current and current[key] != snapshot[key]:
            conflicts.append(f"{field.describe()}: in het protocol staat nu {fmt(current[key])}, bij het exporteren was dat {fmt(snapshot[key])}.")
            continue
        cleared = new in ("", None) and field.kind != "moments"
        if cleared and field.optional:
            problem = None  # een optionele cel leegmaken betekent: niets tonen
        else:
            problem = field.check(new) if field.check else None
            if problem is None and cleared:
                problem = "mag niet leeg zijn"
        if problem:
            errors.append(f"{field.describe()}: {problem} (je vulde {fmt(new)} in).")
            continue
        changes.append((key, field, snapshot[key], new))
    return changes, conflicts, errors, warnings


def fmt(value):
    if isinstance(value, list):
        return "; ".join(f"week {w}{'-' + str(t) if t else ''}: {label}" for w, t, label in value) or "(leeg)"
    if value in ("", None):
        return "(leeg)"
    text = str(value).replace("\n", " / ")
    return f"'{text}'" if isinstance(value, str) else text


def moment_changes(old, new):
    """Wat is er veranderd in het testschema? Geeft korte regels per testmoment."""
    def label(week, week_to):
        return f"week {week}-{week_to}" if week_to else f"week {week}"
    old_by, new_by = {w: (t, text) for w, t, text in old}, {w: (t, text) for w, t, text in new}
    lines = []
    for week in sorted(set(old_by) | set(new_by)):
        if week not in new_by:
            lines.append(f"verwijderd: {label(week, old_by[week][0])}: {old_by[week][1]}")
        elif week not in old_by:
            lines.append(f"toegevoegd: {label(week, new_by[week][0])}: {new_by[week][1]}")
        elif old_by[week] != new_by[week]:
            lines.append(f"{label(week, new_by[week][0])}: {fmt(old_by[week][1])} → {fmt(new_by[week][1])}"
                         + (f" (weken tot: {old_by[week][0]} → {new_by[week][0]})" if old_by[week][0] != new_by[week][0] else ""))
    return lines


def placeholder_problems(P, protos):
    """Een placeholder zoals {threshold} mag enkel staan waar het getal ook bestaat (zelfde regel als de app)."""
    problems = []

    def check(where, text, values):
        for name in set(re.findall(r"\{(threshold|weeks|months|perWeek)\}", text or "")):
            if not isinstance(values.get(name), (int, float)):
                problems.append(f"{where}: {{{name}}} staat in de tekst, maar er is geen getal '{name}' bij.")

    for proto in protos:
        d = P[proto]
        for level in d.get("levels", []):
            for c in level["criteria"]:
                vals = {"threshold": c.get("threshold"), "weeks": c.get("weeks"), "months": c.get("months")}
                for f in ("label", "patientLabel", "note"):
                    check(f"{proto.upper()} · criterium {c['id']} ({f})", c.get(f), vals)
        for m in d.get("milestones", []):
            t = m["trigger"]
            vals = {"threshold": t.get("threshold"), "weeks": t.get("weeks"), "perWeek": t.get("perWeek")}
            for f in ("label", "description"):
                check(f"{proto.upper()} · mijlpaal {m['id']} ({f})", m.get(f), vals)
        if "prevention" in d:
            check(f"{proto.upper()} · preventie (tekst)", d["prevention"].get("patientText"), d["prevention"])
    return problems


def structure_problems(P, protos):
    """Controles over meerdere cellen heen (de app controleert dit ook bij het laden)."""
    problems = []
    for proto in protos:
        for group in P[proto].get("testGroups", []):
            for test in group["tests"]:
                if test["type"] not in ("bilateral", "single"):
                    continue
                for entry in (test.get("units") or [test]):
                    if not entry["min"] < entry["max"]:
                        unit = f" ({entry['unit']})" if "units" in test else ""
                        problems.append(f"{proto.upper()} · test {test['id']}{unit}: 'Min' moet kleiner zijn dan 'Max'.")
    return problems


def literal_number_warnings(changes, P):
    """Waarschuwing als de omschrijving nog het oude getal als gewone tekst bevat."""
    warnings = []
    for key, field, old, new in changes:
        if not key.startswith("Criteria|") or not key.endswith("|Grens"):
            continue
        _, proto, cid, _ = key.split("|")
        crit = next(c for lv in P[proto]["levels"] for c in lv["criteria"] if c["id"] == cid)  # P = het protocol ná de wijzigingen
        label = crit.get("label", "")
        if old is not None and re.search(rf"(?<![\d.,]){re.escape(str(old).replace('.', ','))}(?![\d.,])", label):
            warnings.append(f"{proto.upper()} · {cid}: de omschrijving bevat nog '{old}' als gewone tekst. Zet {{threshold}} op die plek om ze mee te laten veranderen.")
    return warnings


def bump_version(old, today):
    if not old.startswith(today):
        return today
    match = re.fullmatch(rf"{re.escape(today)}(?:\.(\d+))?", old)
    return f"{today}.{int(match.group(1) or 1) + 1}" if match else today


def bump_cache(sw_path):
    text = Path(sw_path).read_text(encoding="utf-8")
    match = re.search(r"const CACHE_VERSION = 'v(\d+)';", text)
    if not match:
        raise ProtocolError("In sw.js staat geen CACHE_VERSION.")
    new = f"v{int(match.group(1)) + 1}"
    Path(sw_path).write_text(text.replace(match.group(0), f"const CACHE_VERSION = '{new}';", 1), encoding="utf-8")
    return new


# --------------------------------------------------------------------------------------------
# Opdrachten
# --------------------------------------------------------------------------------------------

def cmd_export(args):
    P = load_protocols(args.data)
    out = Path(args.uit)
    out.parent.mkdir(parents=True, exist_ok=True)
    values = write_workbook(P, out)
    print(f"Gemaakt: {out}  ({len(values)} aanpasbare waarden)")
    print("Pas enkel de gele cellen aan, bewaar het bestand en laat het verwerken met: protocollen import")
    return 0


def cmd_import(args):
    path = Path(args.van)
    if not path.exists():
        raise ProtocolError(f"Het bestand {path} bestaat niet. Maak het eerst met 'export'.")
    P = load_protocols(args.data)
    sheets = build_sheets(P)
    _, fields = collect(P, sheets)
    wb = load_workbook(path)  # formules blijven formules; we lezen enkel de gele cellen
    changes, conflicts, errors, warnings = diff(P, wb, sheets, fields)

    if not changes and not conflicts and not errors:
        print("Geen wijzigingen: het Excel-bestand is hetzelfde als het protocol.")
        return 0

    for _, field, old, new in changes:
        if field.kind == "moments":
            for line in moment_changes(old, new):
                print(f"  {field.where} · {line}")
        else:
            print(f"  {field.describe()}: {fmt(old)} → {fmt(new)}")

    trial = json.loads(json.dumps(P))
    for key, field, _old, new in changes:
        field.set(trial, new)
    errors += placeholder_problems(trial, PROTOCOLS) + structure_problems(trial, PROTOCOLS)
    warnings += literal_number_warnings(changes, trial)

    for message in warnings:
        print(f"  LET OP: {message}")
    if conflicts:
        print("\nConflicten (het protocol is intussen op deze plek veranderd; maak een nieuw bestand met 'export'):")
        for message in conflicts:
            print(f"  - {message}")
    if errors:
        print("\nFouten (niets is veranderd):")
        for message in errors:
            print(f"  - {message}")
    if conflicts or errors:
        return 1

    print(f"\n{len(changes)} wijziging(en) klaar om door te voeren.")
    if not args.toepassen:
        print("Dit was een controle: er is niets veranderd. Voer uit met --toepassen om het door te voeren.")
        return 0

    today = datetime.date.today().isoformat()
    touched = {key.split("|")[1] for key, *_ in changes}
    for proto in touched:
        trial[proto]["version"] = bump_version(trial[proto].get("version", ""), today)
    save_protocols(args.data, trial, only=touched)
    cache = bump_cache(args.sw)
    for proto in sorted(touched):
        print(f"Doorgevoerd in protocol-{proto}.json (versie {trial[proto]['version']}).")
    print(f"Cacheversie van de app verhoogd naar {cache}. Maak nu een nieuw Excel-bestand met 'export' voor je verder aanpast.")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(prog="protocollen", description=__doc__.split("\n\n")[0])
    parser.add_argument("--data", default=str(ROOT / "data"), help="map met de protocolbestanden")
    parser.add_argument("--sw", default=str(ROOT / "sw.js"), help="pad naar sw.js")
    sub = parser.add_subparsers(dest="opdracht", required=True)
    export = sub.add_parser("export", help="maak het Excel-bestand")
    export.add_argument("--uit", default=str(ROOT / "local" / "protocollen.xlsx"))
    imp = sub.add_parser("import", help="lees het Excel-bestand en toon of voer de wijzigingen door")
    imp.add_argument("--van", default=str(ROOT / "local" / "protocollen.xlsx"))
    imp.add_argument("--toepassen", action="store_true", help="voer de wijzigingen echt door")
    args = parser.parse_args(argv)
    try:
        return {"export": cmd_export, "import": cmd_import}[args.opdracht](args)
    except ProtocolError as error:
        print(f"Fout: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
