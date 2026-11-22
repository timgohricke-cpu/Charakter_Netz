#!/usr/bin/env python3
"""Erzeugt tests/data/silber.json – Testboard „Silber – Die Trilogie der Träume“ (Kerstin Gier)
im Import-Format von Charakter-Netz (format charakter-netz, version 2).

Zweck: realistisches, mittelgroßes Board mit vielen Mehrfach-Fraktionen (für „✨ Anordnen“ / Inseln)
und als Testboard für „Ersteller übertragen“. Nebenfiguren, über die die Quellen wenig sagen,
sind ausdrücklich als solche beschrieben (keine erfundenen Details).
Aufruf: python3 tests/data/make_silber.py  -> schreibt tests/data/silber.json
"""
import json, math, os

F = {  # Fraktionen: Kurzname -> (Name, Farbe)
    'silber':  ('Familie Silber', '#9e9e9e'),
    'spencer': ('Familie Spencer', '#1565c0'),
    'harper':  ('Familie Harper', '#2e7d32'),
    'pp':      ('Familie Porter-Peregrin', '#ad1457'),
    'clark':   ('Familie Clark', '#6d4c41'),
    'traum':   ('Traumreisende', '#7e57c2'),
    'kult':    ('Dämonenbeschwörung (Friedhof)', '#b71c1c'),
    'frognal': ('Frognal Academy', '#f9a825'),
    'secrecy': ('Tittle-Tattle / Secrecy', '#00897b'),
    'wesen':   ('Traumwesen & Traumgestalten', '#26c6da'),
    'tiere':   ('Tiere', '#ef6c00'),
}

# (Schlüssel, Name, Kurzbeschreibung, Fraktionen (erste = Hauptfraktion), verstorben, Ort, lange Info)
C = [
    ('liv', 'Liv Silber', 'Olivia „Liv“ Silber, 16, Ich-Erzählerin, Traumreisende', ['silber', 'traum', 'frognal', 'kult'], False, 'London',
     'Olivia „Liv“ Silber ist die Hauptfigur und Erzählerin der Trilogie. Sie ist mit Mutter, Schwester, Kindermädchen und Hündin '
     'schon unzählige Male umgezogen (u. a. München, Pretoria, Utrecht, Berkeley, Hyderabad, Edinburgh) und wünscht sich ein '
     'dauerhaftes Zuhause. In London kommt sie an die Frognal Academy und stolpert eines Nachts in Graysons Traum – auf einen '
     'Friedhof, wo Grayson, Henry, Arthur und Jasper einen Dämon beschwören. Liv ist schlau, neugierig, kann Kung-Fu (bei Mr Wu in '
     'Berkeley gelernt) und spielt Gitarre. Sie verliebt sich in Henry Harper; ihr Spitzname bei Mia, Henry und Grayson: „Livvy“.\n\n'
     'Band 1: Friedhofsritual, Herbstball, Mausoleum – Henry und Grayson retten sie vor Anabel.\n'
     'Band 2: Streit und Trennung von Henry nach dem Traum mit „B“; Arthur bedroht Mia.\n'
     'Band 3: die Notlüge mit dem erfundenen Freund „Rasmus“, Versöhnung mit Henry, Arthur wird in einem Traum gefangen.'),
    ('mia', 'Mia Silber', 'Livs jüngere Schwester (13), Spezialistin für Ermittlungen jeder Art', ['silber', 'frognal'], False, 'London',
     'Detektivisch veranlagt, mit Zahnspange und Brille. Schlafwandelt in Band 2 und wird dabei von Arthur fast aus dem Fenster gelockt. '
     'Deckt in Band 3 auf, wer hinter dem Blog „Tittle-Tattle“ (Secrecy) steckt.'),
    ('ann', 'Ann Matthews', 'Livs und Mias Mutter, Literaturprofessorin', ['silber'], False, 'London',
     'Amerikanerin, zieht für ihre Lehraufträge ständig um. Verliebt sich in Ernest Spencer, der ihr in Band 2 einen Antrag macht; '
     'Hochzeit am Ende von Band 3 an einem Strand.'),
    ('vater', 'Livs Vater', 'Vater von Liv und Mia, lebt in Zürich (im Film „Paul Silber“)', ['silber'], False, 'Zürich', ''),
    ('lottie', 'Lottie Wastlhuber', 'Bayerisches Kindermädchen der Silbers, seit zwölf Jahren in der Familie', ['silber'], False, 'London',
     'Kam als Au-pair-Mädchen und blieb. Kocht, backt, flicht Gretel-Frisuren und hält die Familie zusammen. Charles Spencer interessiert '
     'sich für sie; in Band 3 verliebt sie sich in den falschen Hochzeitsplaner Pascal und beschließt, nach Deutschland zurückzugehen.'),
    ('butter', 'Buttercup', 'Hündin der Silbers („Princess Buttercup formerly known as Doctor Watson“)', ['tiere', 'silber'], False, 'London', ''),
    ('ernest', 'Ernest Spencer', '„Mr. Planänderung“, Staranwalt, Anns neue Liebe', ['spencer'], False, 'London',
     'Über 50, Vollglatze, große Ohren, etwas zu weiße Zähne. Anwalt für internationales Wirtschaftsrecht, Vater der Zwillinge Grayson '
     'und Florence, Bruder von Charles. Macht Ann bei seinem 53. Geburtstag einen Heiratsantrag.'),
    ('grayson', 'Grayson Spencer', 'Ernests Sohn (18), Zwilling von Florence, Livs Stiefbruder', ['spencer', 'traum', 'frognal', 'kult'], False, 'London',
     'Basketballspieler, Henrys bester Freund, freundlich zu den Silbers. Mit Emily Clark zusammen, bis sie sich in Band 2 trennen. '
     'Rettet Mia in Band 2, indem er Arthur weckt.'),
    ('florence', 'Florence Spencer', 'Ernests Tochter (18), Zwilling von Grayson', ['spencer', 'frognal', 'secrecy'], False, 'London',
     'Begrüßt Ann zunächst freundlich, wird aber feindselig, als die Silbers einziehen. Beste Freundin von Emily. '
     'In Band 3 stellt sich heraus: Sie hat den Secrecy-Blog übernommen (zusammen mit Pandora Porter-Peregrin und Sam Clark).'),
    ('charles', 'Charles Spencer', 'Ernests Bruder, Zahnarzt', ['spencer'], False, 'London',
     'Liv schleicht sich in Band 2 in seinen Traum, um herauszufinden, ob er es mit Lottie ernst meint.'),
    ('bocker', 'Philippa Adelaide Spencer', '„Das Bocker“, Ernests Mutter, Großmutter der Zwillinge', ['spencer'], False, 'London',
     'Konservativ; mag weder Anns amerikanische Herkunft noch Lotties deutsche. Stolz auf ihren pfauenförmigen Buchsbaum „Mr Snuggles“, '
     'den Liv und Mia in Band 2 zurechtstutzen. Mag Emily und ist über Graysons Trennung bestürzt.'),
    ('snuggles', 'Mr Snuggles', 'Pfauenförmiger Buchsbaum von Mrs Spencer', ['spencer'], False, 'London', ''),
    ('erstefrau', 'Ernests erste Frau', 'Mutter von Grayson und Florence, an Chorea Huntington gestorben', ['spencer'], True, '', ''),
    ('dimbleby', 'Mrs Dimbleby', 'Hausangestellte und Köchin der Spencers', ['spencer'], False, 'London', ''),
    ('henry', 'Henry Harper', '18, träumt für sein Leben gern, Livs große Liebe', ['harper', 'traum', 'frognal', 'kult'], False, 'London',
     'Blonde, wild abstehende Haare, graue Augen. Flügelspieler der Frognal Flames, Kandidat für ein Stipendium in St Andrews. '
     'Sohn eines bekannten Londoner Geschäftsmanns aus dessen dritter Ehe. Lädt Liv lange nicht zu sich nach Hause ein. '
     'Trennung in Band 2 (Traum mit „B“), Versöhnung in Band 3; würde für Liv sein Leben riskieren.'),
    ('amy', 'Amy Harper', 'Henrys kleine Schwester', ['harper'], False, 'London', ''),
    ('milo', 'Milo Harper', 'Henrys Bruder', ['harper'], False, 'London', ''),
    ('ron', 'Ron Harper', 'Aus Henrys Familie (Nebenfigur laut Fan-Wiki)', ['harper'], False, 'London', ''),
    ('vaterh', 'Henrys Vater', 'Bekannter Londoner Geschäftsmann, mehrfach verheiratet', ['harper'], False, 'London', ''),
    ('arthur', 'Arthur Hamilton', '„Der schönste Junge der westlichen Hemisphäre“ – später der Bösewicht', ['traum', 'frognal', 'kult'], False, 'London',
     'Früher Freund von Henry, Grayson und Jasper, Anabels Freund. Traumreisender, der Menschen mit einem Codewort auch im Wachzustand '
     'lenken kann. Will sich an Liv rächen; gibt sich in Band 2 in Mias Träumen als Liv aus. In Band 3 beißt ihn eine Schlange, er wird '
     'als Held gefeiert – und schließlich mit Anabels Hilfe im Traum einer Toten gefangen.'),
    ('jasper', 'Jasper Grant', '„Der dümmste Junge der westlichen Hemisphäre“', ['traum', 'frognal', 'kult'], False, 'London',
     'Freund von Grayson, Henry und Arthur. Verbringt Band 2 größtenteils im Auslandsjahr in Frankreich. Persephone schwärmt für ihn. '
     'Richtet in Band 3 die Willkommensparty für Arthur aus.'),
    ('anabel', 'Anabel Scott', 'Arthurs Freundin, wollte Liv opfern', ['kult', 'traum'], False, 'London',
     'Wuchs bis zum dritten Lebensjahr bei einer Mutter auf, die Dämonen verehrte. Will Liv in Band 1 opfern und kommt in eine '
     'psychiatrische Klinik. Wird entlassen, manipuliert ihren Psychiater („Senator Tod“) in Band 3 bis ins Koma – hilft dann aber '
     'Liv und Henry, Arthur zu fangen, und scheint sich geändert zu haben.'),
    ('anabelmutter', 'Anabels Mutter', 'Verehrte Dämonen; Anabel lebte bis zum 3. Lebensjahr bei ihr', ['kult'], False, '', ''),
    ('tod', 'Senator Tod', 'Spitzname von Anabels Psychiater – liegt in Band 3 im Koma', ['traum'], False, 'London', ''),
    ('tote', 'Die tote Frau', 'In ihrem Traum wird Arthur am Ende gefangen', ['wesen'], True, '', ''),
    ('persephone', 'Persephone Porter-Peregrin', 'Livs wahrgewordener Albtraum – und später gute Freundin', ['pp', 'frognal'], False, 'London',
     'Soll Liv an der Schule herumführen. Reich und anfangs arrogant, schwärmt für Jasper. Fuchtelt auf Jaspers Party unter Arthurs '
     'Einfluss mit einer Pistole herum. Wird eine von Livs engsten Freundinnen.'),
    ('pandora', 'Pandora Porter-Peregrin', 'Persephones Schwester, schreibt mit an Secrecy', ['pp', 'secrecy'], False, 'London', ''),
    ('priamos', 'Priamos Porter-Peregrin', 'Persephones Bruder', ['pp'], False, 'London', ''),
    ('emily', 'Emily Clark', 'Florences beste Freundin, Graysons Freundin (bis Band 2)', ['clark', 'frognal'], False, 'London',
     'Chefredakteurin der Schülerzeitung „Reflexx“. Ihr Bruder Sam hilft Florence in Band 3 beim Secrecy-Blog.'),
    ('sam', 'Sam Clark', 'Emilys Bruder, schreibt mit an Secrecy', ['clark', 'secrecy'], False, 'London', ''),
    ('secrecy', 'Secrecy', 'Pseudonym hinter dem Lästerblog „Tittle-Tattle“', ['secrecy', 'frognal'], False, 'Frognal Academy',
     'Enthüllt boshaft Geheimnisse von Schülern und Lehrern der Frognal Academy – auch über Liv, „die Neue“. Wer ursprünglich dahintersteckt, '
     'bleibt offen; in Band 3 deckt Mia auf, dass Florence (mit Pandora und Sam) den Blog weitergeführt hat.'),
    ('lawrence', 'Mrs Lawrence', 'Französischlehrerin der Frognal Academy', ['frognal'], False, 'Frognal Academy',
     'Klettert unter Arthurs Einfluss in der Mensa auf einen Tisch und plaudert Privates aus.'),
    ('wu', 'Mr Wu', 'Livs Kung-Fu-Lehrer aus Berkeley – im Traum „Wu, die Tigerpranke“, Torwächter', ['wesen'], False, 'Berkeley / Traumkorridor',
     'Der echte Mr Wu unterrichtete Liv in Berkeley. Im Traum steht er in schwarzem Seidenpyjama mit Tigerkopf als sprücheklopfender '
     'Torwächter vor ihrer Tür.'),
    ('b', '„B“', 'Mädchen, mit dem Liv Henry in einem Traum sieht', ['wesen'], False, 'Traumkorridor', ''),
    ('rasmus', 'Rasmus', 'Livs erfundener Freund (Notlüge in Band 3)', ['wesen'], False, '', ''),
    ('pascal', 'Pascal de Gobineau', 'Falscher Hochzeitsplaner, Lottie verliebt sich in ihn', [], False, 'London', ''),
    ('freddy', 'Fürchterlicher Freddy', 'Traumwesen (Nebenfigur laut Fan-Wiki)', ['wesen'], False, 'Traumwelt', ''),
    ('lulil', 'Lulil', 'Traumwesen (Nebenfigur laut Fan-Wiki)', ['wesen'], False, 'Traumwelt', ''),
    ('spot', 'Spot', 'Tier (Nebenfigur laut Fan-Wiki)', ['tiere'], False, '', ''),
    ('hazel', 'Hazel Pritchard', 'Nebenfigur (laut Fan-Wiki)', ['frognal'], False, '', ''),
    ('daisy', 'Daisy Dawn Steward', 'Nebenfigur (laut Fan-Wiki)', [], False, '', ''),
    ('tomh', 'Tom Holland', 'Nebenfigur (laut Fan-Wiki)', [], False, '', ''),
    ('madison', 'Madison', 'Nebenfigur (laut Fan-Wiki)', [], False, '', ''),
    ('nathan', 'Nathan Woods', 'Nebenfigur (laut Fan-Wiki)', [], False, '', ''),
    ('matt', 'Matt Davenport', 'Nebenfigur (laut Fan-Wiki)', [], False, '', ''),
    ('callum', 'Callum Caspers', 'Nebenfigur (laut Fan-Wiki)', [], False, '', ''),
    ('lindsay', 'Lindsay', 'Nebenfigur (laut Fan-Wiki)', [], False, '', ''),
    ('samantha', 'Samantha', 'Nebenfigur (laut Fan-Wiki)', [], False, '', ''),
    ('aubrey', 'Aubrey', 'Nebenfigur (laut Fan-Wiki)', [], False, '', ''),
    ('abigail', 'Abigail', 'Nebenfigur (laut Fan-Wiki)', [], False, '', ''),
    ('theo', 'Theo Ellis', 'Nebenfigur (laut Fan-Wiki)', [], False, '', ''),
    ('honeycutt', 'Mrs Honeycutt', 'Nebenfigur (laut Fan-Wiki)', [], False, '', ''),
    ('muriel', 'Muriel Honeycutt', 'Nebenfigur (laut Fan-Wiki)', [], False, '', ''),
    ('alfred', 'Alfred', 'Nebenfigur (laut Fan-Wiki)', [], False, '', ''),
    ('gil', 'Gil Walker', 'Nebenfigur (laut Fan-Wiki)', [], False, '', ''),
    ('fats', 'Mrs Fatsourakis', 'Nebenfigur (laut Fan-Wiki)', [], False, '', ''),
    ('anderson', 'Dr. Otto Anderson', 'Nebenfigur (laut Fan-Wiki)', [], False, '', ''),
    ('maisie', 'Maisie Brown', 'Nebenfigur (laut Fan-Wiki)', [], False, '', ''),
    ('triggs', 'Harry Triggs', 'Nebenfigur (laut Fan-Wiki)', [], False, '', ''),
]

# (a, b, kurz, lang)
L = [
    ('liv', 'mia', 'Schwestern', 'Unzertrennlich, „schwer entflammbar“ – ermitteln gemeinsam.'),
    ('liv', 'ann', 'Mutter', ''), ('mia', 'ann', 'Mutter', ''),
    ('liv', 'vater', 'Vater', 'Lebt in Zürich.'), ('mia', 'vater', 'Vater', ''), ('ann', 'vater', 'getrennt', ''),
    ('liv', 'lottie', 'Kindermädchen', ''), ('mia', 'lottie', 'Kindermädchen', ''), ('ann', 'lottie', 'Kindermädchen der Familie', ''),
    ('liv', 'butter', 'Hündin', ''), ('mia', 'butter', 'Hündin', ''),
    ('ann', 'ernest', 'Paar, Hochzeit in Band 3', 'Antrag zu Ernests 53. Geburtstag (Band 2), Hochzeit am Strand (Band 3).'),
    ('ernest', 'grayson', 'Vater', ''), ('ernest', 'florence', 'Vater', ''), ('grayson', 'florence', 'Zwillinge', ''),
    ('ernest', 'charles', 'Brüder', ''), ('ernest', 'bocker', 'Mutter', ''), ('bocker', 'grayson', 'Großmutter', ''), ('bocker', 'florence', 'Großmutter', ''),
    ('ernest', 'erstefrau', 'erste Ehefrau († Huntington)', ''), ('erstefrau', 'grayson', 'Mutter', ''), ('erstefrau', 'florence', 'Mutter', ''),
    ('bocker', 'snuggles', 'ihr ganzer Stolz', ''), ('liv', 'snuggles', 'zurechtgestutzt (Band 2)', 'Liv und Mia schneiden den Buchsbaum-Pfau in Form – Florence ist danach endgültig gegen sie.'),
    ('mia', 'snuggles', 'zurechtgestutzt', ''), ('bocker', 'ann', 'mag sie nicht', ''), ('bocker', 'lottie', 'mag sie nicht', ''), ('bocker', 'emily', 'mag sie', ''),
    ('dimbleby', 'ernest', 'Köchin', ''), ('dimbleby', 'grayson', 'kocht für ihn', ''),
    ('charles', 'lottie', 'verliebt in sie', 'Liv prüft in seinem Traum, ob er es ernst meint.'), ('liv', 'charles', 'schleicht in seinen Traum', ''),
    ('liv', 'grayson', 'Stiefgeschwister', 'Er leiht ihr einen Pullover; Liv folgt ihm in seinen Traum.'), ('mia', 'grayson', 'rettet sie (Band 2)', 'Weckt Arthur, als Mia schlafwandelt.'),
    ('liv', 'florence', 'Stiefschwester, feindselig', ''), ('mia', 'florence', 'enttarnt sie als Secrecy', ''),
    ('liv', 'henry', 'Liebe', 'Erster Freund; Trennung in Band 2, Versöhnung in Band 3.'), ('henry', 'grayson', 'beste Freunde', ''),
    ('henry', 'amy', 'Schwester', ''), ('henry', 'milo', 'Bruder', ''), ('amy', 'milo', 'Geschwister', ''), ('henry', 'vaterh', 'Vater', ''),
    ('vaterh', 'amy', 'Vater', ''), ('vaterh', 'milo', 'Vater', ''), ('ron', 'henry', 'Familie', ''),
    ('henry', 'b', 'im Traum mit ihr gesehen', ''), ('liv', 'b', 'Eifersucht', ''),
    ('arthur', 'henry', 'ehemalige Freunde', ''), ('arthur', 'grayson', 'ehemalige Freunde', ''), ('arthur', 'jasper', 'Freunde', ''),
    ('jasper', 'grayson', 'Freunde', ''), ('jasper', 'henry', 'Freunde', ''),
    ('arthur', 'anabel', 'Paar', ''), ('arthur', 'liv', 'Rache', 'Will sich an Liv rächen und lenkt Menschen mit einem Codewort.'),
    ('arthur', 'mia', 'lockt sie im Schlaf', 'Gibt sich in Mias Träumen als Liv aus.'), ('arthur', 'lawrence', 'manipuliert', ''),
    ('arthur', 'persephone', 'manipuliert (Pistole)', ''), ('arthur', 'tote', 'im Traum gefangen', ''),
    ('anabel', 'liv', 'wollte sie opfern', 'Mausoleum am Herbstball (Band 1).'), ('anabel', 'anabelmutter', 'Mutter (Dämonenkult)', ''),
    ('anabel', 'tod', 'Psychiater, ins Koma manipuliert', ''), ('anabel', 'henry', 'hilft gegen Arthur', ''),
    ('persephone', 'liv', 'Freundinnen', 'Anfangs Albtraum, später enge Freundin.'), ('persephone', 'jasper', 'schwärmt für ihn', ''),
    ('persephone', 'pandora', 'Schwestern', ''), ('persephone', 'priamos', 'Geschwister', ''), ('pandora', 'priamos', 'Geschwister', ''),
    ('florence', 'emily', 'beste Freundinnen', ''), ('grayson', 'emily', 'Paar (bis Band 2)', ''), ('emily', 'sam', 'Geschwister', ''),
    ('florence', 'secrecy', 'führt den Blog weiter', ''), ('pandora', 'secrecy', 'schreibt mit', ''), ('sam', 'secrecy', 'schreibt mit', ''),
    ('secrecy', 'liv', 'lästert über „die Neue“', ''), ('mia', 'secrecy', 'deckt auf', ''),
    ('liv', 'wu', 'Kung-Fu-Lehrer', 'Berkeley; im Traum Torwächter.'), ('liv', 'rasmus', 'erfunden', ''), ('henry', 'rasmus', 'eifersüchtig', ''),
    ('lottie', 'pascal', 'verliebt', ''), ('pascal', 'ann', '„plant“ die Hochzeit', ''), ('jasper', 'arthur', 'Willkommensparty (Band 3)', ''),
]


def main():
    fid = {k: f'f-{k}' for k in F}
    chars = []
    n = len(C)
    for i, (k, name, short, facs, dead, place, info) in enumerate(C):
        # Absichtlich unordentliche Startpositionen (Raster mit Versatz), damit „✨ Anordnen“ etwas zu tun hat
        x = (i % 9) * 170 + (60 if (i // 9) % 2 else 0) - 700
        y = (i // 9) * 160 + ((i * 37) % 50) - 500
        chars.append({'id': k, 'name': name, 'short': short, 'info': info, 'place': place, 'x': x, 'y': y,
                      'mapPos': None, 'factions': [fid[f] for f in facs], 'dead': dead, 'image': None})
    keys = {c['id'] for c in chars}
    seen = set(); links = []
    for i, (a, b, s, lg) in enumerate(L):
        assert a in keys and b in keys, (a, b)
        p = tuple(sorted((a, b)))
        if p in seen:
            continue
        seen.add(p)
        links.append({'id': f'l{i}', 'a': a, 'b': b, 'short': s, 'long': lg})
    out = {'format': 'charakter-netz', 'version': 2, 'name': 'Silber – Die Trilogie der Träume',
           'factions': [{'id': fid[k], 'name': v[0], 'color': v[1]} for k, v in F.items()],
           'characters': chars, 'links': links, 'map': None}
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'silber.json')
    with open(p, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print(f'{p}: {len(chars)} Charaktere, {len(links)} Verbindungen, {len(F)} Fraktionen')


if __name__ == '__main__':
    main()
