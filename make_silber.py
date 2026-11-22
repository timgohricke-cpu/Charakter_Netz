#!/usr/bin/env python3
"""Erzeugt tests/data/silber.json – Testboard „Silber – Die Trilogie der Träume“ (Kerstin Gier)
im Import-Format von Charakter-Netz (format charakter-netz, version 2).

Stand: Ende von Band 3 („Das dritte Buch der Träume“). Feste Fakten (Familie, Geschwister) bleiben,
wechselnde Beziehungen (Liebe, Feindschaft, Freundschaft) zeigen den letzten Stand; der Verlauf steht
in der langen Beschreibung. Quellen: Personenverzeichnisse der drei Bände, Wikipedia-Artikel zur Trilogie,
Silber-Trilogie-Wiki (Fandom). Figuren, über die die Quellen wenig sagen, sind entsprechend knapp beschrieben.

Zweck: realistisches Board mit vielen Mehrfach-Fraktionen und Figuren ohne Verbindung
(für „✨ Anordnen“ / Inseln) und als Board für „Ersteller übertragen“.
Aufruf: python3 tests/data/make_silber.py  -> schreibt tests/data/silber.json
"""
import json, os

F = {  # Fraktionen: Kurzname -> (Name, Farbe). Die erste Fraktion eines Charakters ist seine Hauptfraktion (Insel).
    'silber':   ('Familie Silber', '#9e9e9e'),
    'spencer':  ('Familie Spencer', '#1565c0'),
    'harper':   ('Familie Harper', '#2e7d32'),
    'pp':       ('Familie Porter-Peregrin', '#ad1457'),
    'clark':    ('Familie Clark', '#6d4c41'),
    'honey':    ('Familie Honeycutt', '#c0ca33'),
    'kreis':    ('Kreis der Fünf (Dämonenbeschwörung)', '#b71c1c'),
    'traum':    ('Traumreisende', '#7e57c2'),
    'schule':   ('Frognal Academy – Schüler', '#f9a825'),
    'lehrer':   ('Frognal Academy – Lehrkräfte', '#ff7043'),
    'secrecy':  ('Tittle-Tattle-Blog / Secrecy', '#00897b'),
    'wandler':  ('Wandler des wahren Schattenpfads (Sekte)', '#4e342e'),
    'berkeley': ('Berkeley (Kalifornien)', '#5c6bc0'),
    'wesen':    ('Traumwesen & Traumgestalten', '#26c6da'),
    'tiere':    ('Tiere', '#ef6c00'),
}

# (Schlüssel, Name, Kurzbeschreibung, Fraktionen (erste = Hauptfraktion), verstorben, Ort, lange Info)
C = [
    # ---------- Familie Silber ----------
    ('liv', 'Liv Silber', 'Olivia Gertrude „Liv“ Silber, 16 – Ich-Erzählerin, Traumreisende', ['silber', 'traum', 'kreis', 'schule'], False, 'London (Hampstead)',
     'Hauptfigur und Erzählerin. Ist mit Mutter, Schwester, Kindermädchen und Hündin sechsmal umgezogen (u. a. München, Pretoria, Utrecht, '
     'Berkeley, Hyderabad, Edinburgh) und landet statt in Oxford im Haus von Ernest Spencer in London. Elfte Klasse der Frognal Academy, '
     'Patin dort: Persephone. Kann Kung-Fu (bei Mr Wu in Berkeley gelernt). Spitznamen: Livvy (Mia, Henry, Grayson), Maus (Ann), '
     'Elfenmädchen (Lottie), Blondlöckchen (Senator Tod).\n\n'
     'Band 1: folgt Grayson in seinen Traum, nimmt Anabels Platz im „Kreis der Fünf“ ein, verliebt sich in Henry; am Herbstball wollen '
     'Anabel und Arthur sie opfern – sie bricht Arthur den Kiefer.\n'
     'Band 2: Ärger mit dem Bocker und Secrecy; sieht Henry im Traum mit „B“ und trennt sich; Versöhnung beim Ball der Zwillinge.\n'
     'Band 3: Notlüge über den Exfreund „Rasmus“, übt im Traum des Nachbarn Matt; mit Henry und Anabel sperrt sie Arthur in Muriel '
     'Honeycutts Traum. Endstand: mit Henry zusammen, Persephone ist ihre Freundin.'),
    ('mia', 'Mia Silber', 'Mia Virginia Silber, 13 – „die neue Miss Marple“, enttarnt Secrecy', ['silber', 'schule', 'traum'], False, 'London (Hampstead)',
     'Livs jüngere Schwester, achte Klasse der Frognal Academy, Brille, Spezialistin für Ermittlungen. Patin: Daisy Dawn Steward. '
     'Schlafwandelt in Band 2, weil Arthur sich in ihren Träumen als Liv ausgibt; Grayson rettet sie. Kann Träume selbst gut lenken. '
     'Deckt in Band 3 auf, dass Florence, Pandora Porter-Peregrin und Sam Clark hinter Secrecy stecken – und dass Anabel die frühere Secrecy war.'),
    ('ann', 'Ann Matthews', 'Livs und Mias Mutter, Literaturprofessorin – heiratet Ernest', ['silber', 'spencer'], False, 'London',
     'Amerikanerin, 46, Literaturprofessorin, zieht für ihre Lehraufträge ständig um. Seit Jahren von Livs Vater geschieden. '
     'Ernest macht ihr an seinem 53. Geburtstag einen Antrag (Band 2). Nachdem der Hochzeitsplaner Pascal als Hochstapler auffliegt, '
     'heiraten sie im engsten Kreis an einem Strand in Kent (Ende Band 3).'),
    ('vater', 'Livs und Mias Vater', 'Deutscher Ingenieur, lebt in Zürich – geschieden von Ann', ['silber'], False, 'Zürich',
     'Zieht für seine Arbeit selbst oft um. Liv und Mia verbringen die Ferien bei ihm. Im Buch ohne Vornamen.'),
    ('gertrude', 'Großtante Gertrude', 'Großtante von Liv und Mia', ['silber'], False, '', 'Livs zweiter Vorname ist Gertrude.'),
    ('virginia', 'Großtante Virginia', 'Großtante von Liv und Mia', ['silber'], False, '', 'Mias zweiter Vorname ist Virginia.'),
    ('lottie', 'Lottie Wastlhuber', 'Bayerisches Kindermädchen der Silbers, seit zwölf Jahren in der Familie', ['silber'], False, 'London',
     'Kam als Au-pair und blieb. Kocht, backt (Vanillekipferl, Blaubeermuffins), hält die Familie zusammen; „Es gibt keine Probleme, nur '
     'Herausforderungen.“ Verliebt in Charles Spencer – in seiner Nähe verdreht sie die Buchstaben. In Band 3 schwärmt sie für den '
     'falschen Hochzeitsplaner Pascal; Brautjungfer bei Anns Hochzeit. Will nach der Hochzeit nach Deutschland zurückgehen.'),
    # ---------- Familie Spencer ----------
    ('ernest', 'Ernest Spencer', '„Mr. Planänderung“, Staranwalt – Anns Ehemann', ['spencer'], False, 'London (Hampstead)',
     'Wohlhabender Witwer, 53, Vollglatze, Anwalt für internationales Wirtschaftsrecht. Vater der Zwillinge Grayson und Florence, '
     'Bruder von Charles, Sohn des „Bockers“. Heiratet Ann am Ende von Band 3.'),
    ('erstefrau', 'Ernests erste Frau', 'Mutter von Grayson und Florence, an Chorea Huntington gestorben', ['spencer'], True, '',
     'Starb vor über zehn Jahren. Graysons Herzenswunsch: dass er und Florence nicht an Huntington erkranken.'),
    ('grayson', 'Grayson Spencer', 'Ernests Sohn, 18 – Zwilling von Florence, Livs Stiefbruder', ['spencer', 'traum', 'kreis', 'schule'], False, 'London (Hampstead)',
     'Grayson Ernest Theodor Spencer. Basketballspieler, stellvertretender Chefredakteur der Schülerzeitung, Henrys bester Freund, '
     'von Anfang an freundlich zu Liv und Mia – der große Bruder, den man sich wünscht. Mit Emily Clark zusammen bis Band 2. '
     'Rettet Mia, indem er Arthur weckt. Kauft Harry Triggs dessen alte Kladde ab, um Anabel zu zeigen, dass es den Dämon nicht gibt. '
     'Will in Band 3 auch Senator Tod helfen. Endstand: Single.'),
    ('florence', 'Florence Spencer', 'Ernests Tochter, 18 – Zwilling von Grayson, eine der Secrecys', ['spencer', 'schule', 'secrecy'], False, 'London (Hampstead)',
     'Florence Cecelia Elizabeth Spencer. Erst freundlich zu Ann, dann feindselig zu Liv und Mia (spätestens nach Mr Snuggles). '
     'Beste Freundin von Emily, Ballpartner im ersten Band: Callum Caspers; war mit zwölf in den Nachbarn Matt verliebt. Hat den Secrecy-Blog '
     'von Anabel übernommen und mit Pandora und Sam weitergeführt – Mia stellt sie in Band 3 zur Rede. Beginnt im Herbst ein Jurastudium.'),
    ('charles', 'Charles Spencer', 'Ernests Bruder, Zahnarzt – in Lottie verliebt', ['spencer'], False, 'London',
     '„Das schwarze Schaf der Familie“, eitel, stolz auf ein Hole-in-one. Liv schleicht sich in Band 2 in seinen Traum, um zu prüfen, '
     'ob er es mit Lottie ernst meint (ein Feuermelder weckt ihn). In Band 3 rasend eifersüchtig auf Pascal – er lässt einen Privatdetektiv '
     'ermitteln, der Pascal als Hochstapler entlarvt. Trauzeuge bei Ernests Hochzeit.'),
    ('bocker', 'Philippa Adelaide Spencer', '„Das Bocker“ (Biest in Ocker), Ernests Mutter', ['spencer'], False, 'London',
     'Mrs Spencer senior, 75, trägt Ocker, fährt Bentley. Mag weder Anns amerikanische Herkunft noch Lotties deutsche. Stolz auf ihren '
     'Buchsbaum-Pfau „Mr Snuggles“, den Liv und Mia stutzen. Versteht sich gut mit Emily. Will die Hochzeit nach ihren Vorstellungen planen, '
     'hat in Band 3 einen Nervenzusammenbruch, erholt sich und isst beim Strandpicknick tüchtig mit.'),
    ('dimbleby', 'Mrs Dimbleby', 'Hausangestellte und Köchin der Spencers', ['spencer'], False, 'London (Hampstead)', ''),
    ('snuggles', 'Mr Snuggles', 'Pfauenförmiger Buchsbaum des Bockers', ['spencer'], False, 'London', 'Von Liv und Mia in Band 2 zurechtgestutzt – ein Familienskandal.'),
    # ---------- Familie Harper ----------
    ('henry', 'Henry Harper', '18, träumt für sein Leben gern – Livs Freund', ['harper', 'traum', 'kreis', 'schule'], False, 'London',
     'Blonde, wild abstehende Haare, graue Augen. Flügelspieler der Frognal Flames, will nach St Andrews. Kind aus der dritten Ehe seines '
     'Vaters Ron, lebt mit Mutter, Milo und Amy; hält seine schwierige Familie lange vor Liv geheim. Besucht gern Amys friedliche Träume. '
     'Band 2: Liv sieht ihn im Traum mit „B“ (Biljana) im Whirlpool – Trennung, dann Versöhnung. Band 3: wieder mit Liv zusammen, '
     'sperrt mit ihr und Anabel Arthur in Muriels Traum. Endstand: Paar mit Liv.'),
    ('ron', 'Ron Harper', 'Henrys, Milos und Amys Vater, Geschäftsmann', ['harper'], False, 'London',
     'Ronald Harper, Ende 50, prominenter Londoner Geschäftsmann, dreimal verheiratet, mehrere ältere Kinder aus früheren Ehen. '
     'Derzeitige Geliebte: das Unterwäschemodel Biljana.'),
    ('henrymutter', 'Henrys Mutter', 'Rons dritte (Ex-)Frau, mit der Situation überfordert', ['harper'], False, 'London', 'Im Buch ohne Namen.'),
    ('milo', 'Milo Harper', 'Henrys Bruder, 12', ['harper'], False, 'London', 'Sieht aus wie eine Miniaturausgabe von Henry; lässt gern Dinge mitgehen (z. B. die Tabaksdose des Großvaters).'),
    ('amy', 'Amy Harper', 'Henrys Schwester, 4 – hat die entspanntesten Träume der Welt', ['harper'], False, 'London',
     'Rosa Traumtür mit kichernden Blumen, im Traum Wiesen, Einhörner und Karussell. Henry und Liv erholen sich dort.'),
    ('grandpa', 'Henry Harper (Großvater)', 'Rons Vater – Henrys Namensgeber', ['harper'], True, '', 'Laut Silber-Wiki verstorben.'),
    ('biljana', 'Biljana („B“)', 'Unterwäschemodel, Geliebte von Ron Harper', ['harper'], False, 'London',
     'Die rätselhafte „B“ aus Band 2: Liv sieht Henry in Biljanas Traum zu ihr in den Whirlpool steigen – Anlass für die Trennung.'),
    ('plum', 'Plum', 'Henrys Kater', ['tiere', 'harper'], True, '', 'Wurde von einem Auto überfahren.'),
    # ---------- Kreis der Fünf / Traumwelt ----------
    ('arthur', 'Arthur Hamilton', '„Der schönste Junge der westlichen Hemisphäre“ – der Bösewicht', ['kreis', 'traum', 'schule'], False, 'London',
     'Kapitän der Frognal Flames, Anabels (Ex-)Freund, früher eng befreundet mit Henry, Grayson und Jasper. Am leidenschaftlichsten bei der '
     'Dämonensache; sein Herzenswunsch war vermutlich der Tod von Anabels Exfreund Tom Holland. Schwört Liv nach Band 1 Rache, gibt sich in '
     'Mias Träumen als Liv aus, lenkt Menschen im Wachzustand über ein Codewort (Mrs Lawrence, Persephone). Wird in Band 3 nach einem Schlangenbiss als Held '
     'gefeiert. Endstand: von Anabel, Henry und Liv in Muriel Honeycutts Traum eingesperrt – nur Jasper hält noch zu ihm.'),
    ('jasper', 'Jasper Grant', '„Der dümmste Junge der westlichen Hemisphäre“ – Ex-Traumreisender', ['kreis', 'schule', 'traum'], False, 'London',
     'Von Liv „Rasierspaß-Ken“ genannt, seit der ersten Klasse mit Arthur, Grayson und Henry befreundet, Basketballer. Herzenswunsch: '
     'dass die Frognal Flames immer gewinnen. Band 2 überwiegend in Frankreich, fliegt dort von der Schule. Will mit „Träumen und Dämonen“ '
     'nichts mehr zu tun haben, holt Arthur mit einer Party zurück in die Clique. Besteht die A-Levels, verzichtet aufs Auslandsjahr – '
     'und wird am Ende händchenhaltend mit Persephone im Kino gesehen.'),
    ('anabel', 'Anabel Scott', 'Arthurs Ex-Freundin – wollte Liv opfern, hilft am Ende gegen Arthur', ['kreis', 'traum', 'secrecy', 'wandler'], False, 'Klinik in Surrey',
     'Türkisfarbene Augen, goldene Locken. Lebte bis zum dritten Lebensjahr mit ihrer Mutter in einer Sekte. Fand das „Dämonenbuch“ und '
     'brachte die Jungs zur Beschwörung; war die ursprüngliche Secrecy. Will Liv in Band 1 opfern, kommt in die Psychiatrie, macht ihren '
     'Psychiater zu „Senator Tod“ und versetzt ihn in Band 3 ins Koma. Weist sich schließlich selbst ein, sieht ihre Fehler ein und lockt '
     'Arthur in Muriels Traum. Endstand: Verbündete von Liv und Henry.'),
    ('tod', 'Dr. Otto Anderson („Senator Tod“)', 'Anabels Psychiater – im Traumkorridor „Senator Tod Nord“', ['traum'], False, 'Klinik in Surrey',
     '„Senator Tod Nord“ ist ein Anagramm von Dr. Otto Anderson. Facharzt für Psychiatrie, hofft auf den Chefarztposten und hypnotisiert '
     'Anabel unerlaubt. Sie weiht ihn ins luzide Träumen ein, um ihn zu beeinflussen; im Korridor spricht er in Anagrammen und nennt Liv '
     '„Blondlöckchen“. Endstand: liegt im Koma und träumt, er sei noch Anabels Arzt.'),
    ('emily', 'Emily Clark', 'Florences beste Freundin – Graysons Ex-Freundin', ['clark', 'schule', 'traum'], False, 'London',
     'Chefredakteurin der Schülerzeitung „reflexx“, Bestnoten, eigenes Pferd. Bis Band 2 mit Grayson zusammen, versucht danach, ihn '
     'zurückzugewinnen. Versteht sich blendend mit dem Bocker. Kann seit Band 3 in den Traumkorridor, hält das aber für ihr Unterbewusstsein. '
     'Hat am Ende einen neuen Freund.'),
    ('sam', 'Sam Clark', 'Emilys pickliger kleiner Bruder – einer der Secrecys', ['clark', 'schule', 'secrecy'], False, 'London',
     'Ruft Liv seit der Sache mit Mr Snuggles „Schäm dich“ hinterher. Schreibt mit Florence und Pandora am Secrecy-Blog.'),
    # ---------- Porter-Peregrin ----------
    ('persephone', 'Persephone Porter-Peregrin', 'Livs Patin – erst Albtraum, dann Freundin', ['pp', 'schule'], False, 'London',
     'Elfte Klasse, reich, selbstverliebt, seit jeher in Jasper verliebt (der sie „Aphrodite“ nennt). Während Jasper in Frankreich ist, '
     'mit Gabriel zusammen. Fuchtelt auf Jaspers Party unter Arthurs Einfluss mit einer Waffe. Endstand: Livs Freundin und mit Jasper zusammen.'),
    ('pandora', 'Pandora Porter-Peregrin', 'Persephones ältere Schwester – eine der Secrecys', ['pp', 'schule', 'secrecy'], False, 'London',
     'Im Ballkomitee, gleicher Jahrgang wie Florence.'),
    ('priamos', 'Priamos Porter-Peregrin', 'Persephones älterer Bruder', ['pp'], False, 'London', ''),
    # ---------- Secrecy ----------
    ('secrecy', 'Secrecy', 'Pseudonym hinter dem Lästerblog „Tittle-Tattle“', ['secrecy'], False, 'Frognal Academy',
     'Enthüllt boshaft Geheimnisse von Schülern und Lehrern. Direktorin Cook ließ sogar einen IT-Spezialisten suchen. Ursprünglich Anabel Scott, '
     'danach Florence, Pandora und Sam – Mia deckt es in Band 3 auf. Nach der Enttarnung entschuldigt sich Secrecy online, meldet sich aber '
     'wieder und berichtet über Pascals Betrug.'),
    # ---------- Honeycutt ----------
    ('honeycutt', 'Mrs Honeycutt', 'Becky Honeycutt, 80 – Henrys Nachbarin, „Superstrickerin“', ['honey'], False, 'London',
     'Kleine alte Dame mit zartlila Haar, schwerhörig, füttert Henrys Katze. Strickt im Traum wie im Wachen; Liv, Grayson und Henry finden '
     'in ihrem Traum Zuflucht. Hält Alfred, den Mann ihrer Schwester, für Muriels Mörder.'),
    ('muriel', 'Muriel Honeycutt', 'Mrs Honeycutts Schwester – 1977 von ihrem Mann Alfred ermordet', ['honey'], True, '',
     'Ebenso strickverliebt wie ihre Schwester; offiziell an Asthma gestorben. Ihre Traumtür besteht ausnahmsweise weiter – in diesen Traum '
     'wird Arthur am Ende gesperrt (Mrs Honeycutt hat Liv Muriels Taufkettchen gegeben).'),
    ('alfred', 'Alfred', 'Muriels Ehemann – der „Mörder mit dem Blümchenkissen“', ['honey'], False, '', 'Taucht in Mrs Honeycutts Albträumen auf.'),
    ('papagei', 'Mrs Honeycutts Papagei', 'Haustier von Mrs Honeycutt', ['tiere', 'honey'], False, 'London', ''),
    # ---------- Sekte ----------
    ('anabelmutter', 'Anabels Mutter', 'Mitglied der Sekte „Wandler des wahren Schattenpfads“', ['wandler'], False, '',
     'Wie sie und Anabel dem Massenselbstmord der Sekte entgingen, bleibt offen.'),
    ('donelly', 'Timothy Donelly', 'Gründer und Guru der Sekte', ['wandler'], True, 'Liverpool',
     'Dachdecker, hörte nach zwei Entlassungen „Stimmen“ und gründete die Sekte; Silvester 1999 Massenselbstmord mit sechzehn Anhängern.'),
    ('triggs', 'Harry Triggs', 'Gescheiterter Fantasy-Autor („BloodySword66“), Donellys Rollenspielfreund', [], False, 'London (Islington)',
     'Seine Fantasy-Romane wurden abgelehnt; heute Altenpfleger. Seine alte Kladde stimmt fast wörtlich mit Anabels „Dämonenbuch“ überein – '
     'Grayson kauft sie ihm gegen eine Star-Wars-Figur ab.'),
    ('lulila', 'Lulila', 'Der „Dämon“ – Hüter der Schatten, Fürst der Finsternis', ['wesen', 'kreis'], False, 'Traumwelt',
     'An Halloween von Arthur, Anabel, Henry, Grayson und Jasper beschworen. Stammt in Wahrheit aus Harry Triggs’ Fantasy-Geschichten, '
     'die Timothy Donellys Sekte übernahm.'),
    # ---------- Traumwesen ----------
    ('freddy', 'Fürchterlicher Freddy', 'Steinfigur (Adler-Löwe) – bewacht Graysons Traumtür', ['wesen', 'spencer'], False, 'Vor dem Haus der Spencers',
     'Steht auch in Wirklichkeit vor der Haustür der Spencers – Hochzeitsgeschenk von Graysons Großeltern an seine Eltern. '
     'Im Traum lässt man ihn hinter sich, indem man dreimal „Ydderf“ sagt.'),
    ('wu', 'Mr Wu', 'Livs Kung-Fu-Lehrer aus Berkeley – im Traum Torwächter', ['berkeley', 'wesen'], False, 'Berkeley / Traumkorridor',
     'Spricht in Sprichwörtern. Im Traum „Wu, die Tigerpranke“ im Seidenpyjama: Liv stellt ihn vor ihre Tür und in Band 2 vor Mias Traumtür.'),
    ('molly', 'Molly', 'Eselin – Traumgestalt aus Band 3', ['wesen'], False, 'Traumwelt', ''),
    ('herby', 'Herby', 'Küssendes Krokodil – Traumgestalt aus Band 3', ['wesen'], False, 'Traumwelt', ''),
    # ---------- Tiere ----------
    ('butter', 'Princess Buttercup', 'Hündin der Silbers („formerly known as Doctor Watson“)', ['tiere', 'silber'], False, 'London',
     'Mischling, Geschenk des Vaters bei der Trennung der Eltern. Klaut Handschuhe und Schuhe, hat Respekt vor Spot und folgt Lottie '
     'auf Schritt und Tritt, seit diese ihren Abschied angekündigt hat.'),
    ('spot', 'Spot', 'Roter Kater der Spencers, „sieht aus wie ein Sofakissen“', ['tiere', 'spencer'], False, 'London (Hampstead)', ''),
    ('rasmus', 'Rasmus', 'Livs „Exfreund“ – in Wahrheit der Chow-Chow der Wakefields', ['tiere', 'wesen'], False, 'Berkeley',
     'Liv erfindet ihn in Band 3, um Henry gegenüber erfahrener zu wirken; eigentlich hat sie den Hund der Nachbarn ausgeführt. Sie gesteht die Lüge.'),
    ('barks', 'Sir-Barks-Alot', 'Mops, den Liv ausgeführt hat', ['tiere'], False, 'Berkeley', ''),
    # ---------- Frognal Academy: Schüler ----------
    ('daisy', 'Daisy Dawn Steward', 'Mias Patin an der Frognal – großer Taylor-Lautner-Fan', ['schule'], False, 'Frognal Academy', 'Achte Klasse.'),
    ('gil', 'Gil Walker', 'Mitschüler von Mia – nennt sie „Prinzessin Silberhaar“', ['schule'], False, 'Frognal Academy', 'Schreibt Mia Liebesgedichte.'),
    ('hannah', 'Hannah', 'Klassenkameradin von Mia', ['schule'], False, 'Frognal Academy', ''),
    ('hazel', 'Hazel Pritchard', 'Schülerin – häufiges Opfer von Secrecy', ['schule'], False, 'Frognal Academy',
     'Secrecy macht sich über ihren Aufenthalt in einem Abnehmcamp lustig; offiziell eine Ernährungsumstellung wegen Allergie.'),
    ('madison', 'Madison', 'Schülerin – Jaspers Ex-Freundin, jetzt mit Nathan zusammen', ['schule'], False, 'Frognal Academy',
     'Sie hat mit Jasper Schluss gemacht – Jasper behauptet das Gegenteil.'),
    ('nathan', 'Nathan Woods', 'Spieler der Frognal Flames – Madisons Freund', ['schule'], False, 'Frognal Academy', 'Jasper schubst ihn aus Eifersucht in den Pool und nennt ihn „kleine Knackwurst“.'),
    ('callum', 'Callum Caspers', 'Mathe-Genie – Florences Ballpartner', ['schule'], False, 'Frognal Academy', ''),
    ('gabriel', 'Gabriel', 'Basketballer – Persephones Freund, solange Jasper in Frankreich ist', ['schule'], False, 'Frognal Academy',
     'Persephone trennt sich elf Minuten nach Jaspers Statuswechsel auf „Single“ von ihm.'),
    ('eric', 'Eric Sarstedt', 'Basketballer – Gabriels Freund', ['schule'], False, 'Frognal Academy', ''),
    ('ben', 'Ben Ryan', 'Schüler – pinkelt in Schirmständer, wenn er sich unbeobachtet glaubt', ['schule'], False, 'Frognal Academy', 'Komparsenrolle (laut Secrecy-Blog).'),
    ('maisie', 'Maisie Brown', 'Schülerin – „kleckert manchmal“ (es war nur Limonade!)', ['schule'], False, 'Frognal Academy', 'Komparsenrolle (laut Secrecy-Blog).'),
    ('tom', 'Tom Holland', 'Anabels Ex-Freund – bei einem Unfall gestorben', ['schule'], True, 'London',
     'Ehemaliger Schüler, arrogant, provozierte Arthur. Starb, als ein betrunkener Lkw-Fahrer ihn rammte; Anabel weinte bei der Beerdigung.'),
    ('colin', 'Colin Davison', 'Früherer Kapitän der Basketballmannschaft', ['schule'], False, 'Frognal Academy', 'Nach seinem Weggang wird Arthur Kapitän.'),
    # ---------- Frognal Academy: Lehrkräfte ----------
    ('cook', 'Mrs Cook', 'Direktorin der Frognal Academy', ['lehrer'], False, 'Frognal Academy', 'Führt Mrs Lawrence aus der Kantine; ließ nach Secrecy fahnden.'),
    ('lawrence', 'Mrs Lawrence', 'Christabel Lawrence – Livs Ex-Französischlehrerin', ['lehrer'], False, 'Frognal Academy',
     'Auch Musiklehrerin. Klettert unter Arthurs Einfluss in der Kantine auf einen Tisch und plaudert ihre Affäre mit Mr Vanhagen aus; '
     'kommt danach in eine Klinik.'),
    ('vanhagen', 'Mr Vanhagen', 'Giles Vanhagen – verheirateter Lehrer, Affäre mit Mrs Lawrence', ['lehrer'], False, 'Frognal Academy', ''),
    ('fats', 'Mrs Fatsourakis', 'Vertretung für Mrs Lawrence', ['lehrer'], False, 'Frognal Academy', 'Secrecy lästert gemein über sie; sie brachte zur ersten Stunde selbstgebackene Muffins mit.'),
    ('daniels', 'Mr Daniels', 'Lehrer', ['lehrer'], False, 'Frognal Academy', ''),
    ('zabrinski', 'Mrs Zabrinski', 'Lehrerin – Henry und Grayson diskutieren mit ihr über russische Avantgarde', ['lehrer'], False, 'Frognal Academy', ''),
    ('cooper', 'Miss Cooper', 'Bibliothekarin', ['lehrer'], False, 'Frognal Academy', ''),
    ('beckett', 'Mrs Beckett', 'Musiklehrerin', ['lehrer'], False, 'Frognal Academy', ''),
    ('bridgewater', 'Mr Bridgewater', 'Biologielehrer', ['lehrer'], False, 'Frognal Academy', ''),
    ('fourley', 'Mrs Fourley', 'Chemielehrerin', ['lehrer'], False, 'Frognal Academy', ''),
    ('osborne', 'Mr Osborne', 'Physiklehrer mit einer Schwäche für Sonnenfinsternisse', ['lehrer'], False, 'Frognal Academy', ''),
    # ---------- Berkeley ----------
    ('lindsay', 'Lindsay', 'Anführerin der Mobbing-Clique an Livs Junior Highschool', ['berkeley'], False, 'Berkeley', 'Sieht bei den Prügeleien nur zu und bestimmt. Liv träumt noch heute davon.'),
    ('samantha', 'Samantha', 'Teil der Berkeley-Clique – schlägt zu', ['berkeley'], False, 'Berkeley', ''),
    ('aubrey', 'Aubrey', 'Teil der Berkeley-Clique – hält die Opfer fest', ['berkeley'], False, 'Berkeley', 'Steckte mit der Clique Livs Kopf in die Kloschüssel.'),
    ('abigail', 'Abigail', 'Teil der Berkeley-Clique – steht Schmiere', ['berkeley'], False, 'Berkeley', ''),
    # ---------- Weitere ----------
    ('matt', 'Matt Davenport', '„Matti“ – Nachbar der Spencers, Jurastudent', [], False, 'London (Hampstead)',
     'Zieht in Band 3 wieder bei seinen Eltern ein, fährt einen roten Morgan Plus 8, spielt Saxophon. Florence war mit zwölf in ihn verliebt; '
     'Liv übt in seinem Traum – und Henry erwischt sie dabei.'),
    ('pascal', 'Pascal de Gobineau', 'Falscher Hochzeitsplaner – eigentlich Peter Pickering, 36, spielsüchtig', [], False, 'London',
     'Verdreht Lottie den Kopf; ein von Charles beauftragter Privatdetektiv entlarvt ihn als Hochstapler, die Polizei sucht ihn wegen Betrugs.'),
    ('antony', 'Antony', 'Charles’ alter Studienfreund – prahlt in dessen Traum', [], False, '', ''),
    ('theo', 'Theo Ellis', 'Basketball-Kapitän der Roslyn High – Hassfigur der Frognal', [], False, 'London (Roslyn High)',
     'Theodore E. Ellis, 18, macht eins der besten A-Levels des Landes. Besonders Arthur kann ihn nicht ausstehen.'),
]

# (a, b, kurz, lang) – Endstand am Schluss von Band 3; Verlauf in „lang“
L = [
    # Familie Silber
    ('liv', 'mia', 'Schwestern', 'Unzertrennlich, „schwer entflammbar“, ermitteln gemeinsam.'),
    ('liv', 'ann', 'Mutter', ''), ('mia', 'ann', 'Mutter', ''),
    ('liv', 'vater', 'Vater', 'Ferien bei ihm in Zürich.'), ('mia', 'vater', 'Vater', ''),
    ('ann', 'vater', 'geschieden', 'Seit Jahren getrennt.'),
    ('liv', 'gertrude', 'Großtante', ''), ('mia', 'virginia', 'Großtante', ''),
    ('liv', 'lottie', 'Kindermädchen', 'Seit zwölf Jahren in der Familie.'), ('mia', 'lottie', 'Kindermädchen', ''),
    ('ann', 'lottie', 'Kindermädchen der Familie', 'Lottie verlässt die Familie nach der Hochzeit.'),
    ('liv', 'butter', 'Hündin', ''), ('mia', 'butter', 'Hündin', ''), ('lottie', 'butter', 'weicht ihr nicht von der Seite', ''),
    ('vater', 'butter', 'hat sie geschenkt', 'Geschenk bei der Trennung der Eltern.'),
    # Spencer + Patchwork
    ('ann', 'ernest', 'verheiratet', 'Antrag zu Ernests 53. Geburtstag (Band 2), Hochzeit am Strand in Kent (Ende Band 3).'),
    ('ernest', 'grayson', 'Vater', ''), ('ernest', 'florence', 'Vater', ''),
    ('grayson', 'florence', 'Zwillinge', ''),
    ('ernest', 'erstefrau', 'erste Ehefrau († Huntington)', ''), ('erstefrau', 'grayson', 'Mutter', ''), ('erstefrau', 'florence', 'Mutter', ''),
    ('ernest', 'charles', 'Brüder', 'Charles ist Trauzeuge.'), ('ernest', 'bocker', 'Mutter', ''),
    ('bocker', 'charles', 'Mutter', ''), ('bocker', 'grayson', 'Großmutter („Granny“)', ''), ('bocker', 'florence', 'Großmutter', ''),
    ('charles', 'grayson', 'Onkel', ''), ('charles', 'florence', 'Onkel', ''),
    ('ernest', 'liv', 'Stiefvater', ''), ('ernest', 'mia', 'Stiefvater', ''),
    ('ann', 'grayson', 'Stiefmutter', ''), ('ann', 'florence', 'Stiefmutter', ''),
    ('liv', 'grayson', 'Stiefgeschwister', 'Er leiht ihr anfangs einen Pullover, Liv folgt ihm in seinen Traum; wird ein echter großer Bruder.'),
    ('mia', 'grayson', 'Stiefbruder – rettet sie', 'Weckt Arthur, als Mia schlafwandelt (Band 2).'),
    ('liv', 'florence', 'Stiefschwestern – angespannt', 'Florence ist feindselig, spätestens seit Mr Snuggles; in Band 3 als Secrecy enttarnt.'),
    ('mia', 'florence', 'enttarnt sie als Secrecy', ''),
    ('bocker', 'ann', 'Schwiegermutter – Abneigung', 'Mag Anns amerikanische Herkunft nicht; will die Hochzeit an sich reißen.'),
    ('bocker', 'lottie', 'Vorurteile', 'Verbindet Deutschland nur mit den Nazis.'),
    ('bocker', 'liv', 'gegenseitige Abneigung', 'Liv und Mia nennen sie „das Bocker“.'), ('bocker', 'mia', 'gegenseitige Abneigung', ''),
    ('bocker', 'snuggles', 'ihr ganzer Stolz', ''),
    ('liv', 'snuggles', 'zurechtgestutzt (Band 2)', 'Rache für die Lästereien über Lottie.'), ('mia', 'snuggles', 'zurechtgestutzt', ''),
    ('sam', 'snuggles', '„Schäm dich“', 'Sam ruft Liv seitdem „Schäm dich“ hinterher.'),
    ('bocker', 'emily', 'mag sie', ''),
    ('dimbleby', 'ernest', 'Haushälterin', ''),
    ('spot', 'ernest', 'Kater der Familie', ''), ('spot', 'butter', 'Respekt', 'Buttercup hat Respekt vor Spot.'),
    ('freddy', 'grayson', 'bewacht seine Traumtür', ''), ('freddy', 'bocker', 'ihr Hochzeitsgeschenk', 'Geschenk von Graysons Großeltern an seine Eltern.'),
    ('charles', 'lottie', 'verliebt (Eifersucht)', 'Flirtet seit Band 1; Lottie verdreht in seiner Nähe die Buchstaben. Band 3: eifersüchtig auf Pascal – am Ende offen.'),
    ('liv', 'charles', 'schleicht in seinen Traum', 'Band 2: prüft, ob er Lottie ernst meint.'), ('charles', 'antony', 'Studienfreund', ''),
    # Harper
    ('liv', 'henry', 'Paar', 'Band 1 verliebt; Band 2 Trennung wegen „B“, Versöhnung am Ball der Zwillinge; Band 3 nach der Rasmus-Lüge wieder fest zusammen.'),
    ('henry', 'grayson', 'beste Freunde', ''),
    ('henry', 'milo', 'Bruder', ''), ('henry', 'amy', 'Schwester', 'Henry besucht ihre friedlichen Träume.'), ('milo', 'amy', 'Geschwister', ''),
    ('ron', 'henry', 'Vater', ''), ('ron', 'milo', 'Vater', ''), ('ron', 'amy', 'Vater', ''),
    ('henrymutter', 'henry', 'Mutter', ''), ('henrymutter', 'milo', 'Mutter', ''), ('henrymutter', 'amy', 'Mutter', ''),
    ('ron', 'henrymutter', 'Ex-Frau (3. Ehe)', ''), ('grandpa', 'ron', 'Vater', ''), ('grandpa', 'henry', 'Großvater', ''),
    ('milo', 'grandpa', 'klaut seine Tabaksdose', ''),
    ('ron', 'biljana', 'Geliebte', ''),
    ('henry', 'biljana', 'in ihrem Traum (Whirlpool)', 'Liv sieht es in Band 2 und trennt sich von Henry.'),
    ('liv', 'biljana', 'Grund der Trennung (geklärt)', ''), ('henry', 'plum', 'sein Kater († Unfall)', ''),
    ('liv', 'amy', 'erholt sich in ihren Träumen', ''),
    # Kreis der Fünf / Arthur / Anabel
    ('arthur', 'henry', 'ehemalige Freunde', 'Seit Band 1 Gegner.'), ('arthur', 'grayson', 'ehemalige Freunde', ''),
    ('arthur', 'jasper', 'Freunde', 'Jasper ist der Einzige, der noch zu Arthur hält.'),
    ('jasper', 'grayson', 'Freunde', 'Seit der ersten Klasse.'), ('jasper', 'henry', 'Freunde', ''), ('liv', 'jasper', 'Freunde', 'Er nennt sie „Lizzy“.'),
    ('arthur', 'anabel', 'Ex-Paar – sie überlistet ihn', 'Erst das Vorzeigepaar; am Ende lockt Anabel ihn durch Muriels Traumtür.'),
    ('arthur', 'liv', 'Erzfeinde', 'Liv bricht ihm in Band 1 den Kiefer; er schwört Rache. Liv sperrt ihn mit Henry und Anabel ein.'),
    ('arthur', 'mia', 'lockte sie im Schlaf', 'Gibt sich in Mias Träumen als Liv aus (Band 2).'),
    ('arthur', 'muriel', 'in ihrem Traum gefangen', 'Endstand von Band 3.'),
    ('arthur', 'lawrence', 'manipuliert (Kantine)', ''), ('arthur', 'persephone', 'manipuliert (Waffe auf der Party)', ''),
    ('arthur', 'tom', 'Rivalen', 'Arthur wünschte sich vermutlich Toms Tod.'), ('arthur', 'theo', 'Abneigung', ''),
    ('arthur', 'colin', 'Nachfolger als Kapitän', ''),
    ('anabel', 'liv', 'Verbündete (früher Todfeindin)', 'Wollte Liv in Band 1 opfern; hilft in Band 3 gegen Arthur.'),
    ('anabel', 'henry', 'Verbündete gegen Arthur', ''), ('anabel', 'grayson', 'Kreis der Fünf', ''), ('anabel', 'jasper', 'Kreis der Fünf', ''),
    ('anabel', 'tom', 'Ex-Freund († Unfall)', ''), ('anabel', 'anabelmutter', 'Mutter', 'Lebte bis zum 3. Lebensjahr mit ihr in der Sekte.'),
    ('anabel', 'tod', 'manipuliert ihn ins Koma', 'Weiht ihn ins Träumen ein und sperrt ihn in seinem Traum ein.'),
    ('anabel', 'secrecy', 'ursprüngliche Secrecy', ''), ('anabel', 'florence', 'übergab ihr den Blog', ''), ('mia', 'anabel', 'deckt sie als frühere Secrecy auf', ''),
    ('anabel', 'lulila', 'fand das Dämonenbuch', ''),
    ('arthur', 'lulila', 'beschworen', 'An Halloween vom Kreis der Fünf beschworen.'),
    ('liv', 'tod', '„Blondlöckchen“', 'Senator Tod spricht im Korridor in Anagrammen.'), ('grayson', 'tod', 'will ihm helfen', ''),
    ('grayson', 'triggs', 'kauft ihm die Kladde ab', 'Gegen eine Star-Wars-Figur – Beweis, dass der Dämon erfunden ist.'),
    ('triggs', 'donelly', 'Rollenspielfreunde', ''), ('triggs', 'lulila', 'hat ihn erfunden', ''), ('donelly', 'lulila', 'machte ihn zur Gottheit', ''),
    ('donelly', 'anabelmutter', 'Sektenführer', ''),
    # Honeycutt
    ('honeycutt', 'muriel', 'Schwestern', ''), ('muriel', 'alfred', 'Ehemann und Mörder', 'Muriel starb 1977, offiziell an Asthma.'),
    ('honeycutt', 'alfred', 'Schwager – sie fürchtet ihn', ''), ('honeycutt', 'papagei', 'ihr Papagei', ''),
    ('honeycutt', 'henry', 'Nachbarin', 'Füttert Henrys Katze, wenn die Familie verreist ist.'),
    ('liv', 'honeycutt', 'Zuflucht in ihrem Traum', ''), ('grayson', 'honeycutt', 'Zuflucht in ihrem Traum', ''),
    ('liv', 'muriel', 'hat ihr Taufkettchen', 'Schlüssel zu Muriels Traum.'),
    # Clark / Porter-Peregrin / Secrecy
    ('grayson', 'emily', 'Ex-Paar', 'Getrennt in Band 2; Emily versucht danach, ihn zurückzugewinnen.'),
    ('emily', 'sam', 'Geschwister', ''), ('florence', 'emily', 'beste Freundinnen', ''),
    ('persephone', 'liv', 'Freundinnen', 'Erst Patin und Albtraum, am Ende enge Freundin.'),
    ('persephone', 'jasper', 'Paar (Ende Band 3)', 'Jahrelang einseitig verliebt; am Ende händchenhaltend im Kino.'),
    ('persephone', 'gabriel', 'Ex-Freund', 'Zusammen, während Jasper in Frankreich war.'),
    ('persephone', 'pandora', 'Schwestern', ''), ('persephone', 'priamos', 'Geschwister', ''), ('pandora', 'priamos', 'Geschwister', ''),
    ('florence', 'secrecy', 'eine der Secrecys', ''), ('pandora', 'secrecy', 'eine der Secrecys', ''), ('sam', 'secrecy', 'einer der Secrecys', ''),
    ('florence', 'pandora', 'betreiben den Blog', ''), ('florence', 'sam', 'betreiben den Blog', ''),
    ('mia', 'secrecy', 'enttarnt sie', ''), ('secrecy', 'liv', 'lästert über sie', ''), ('secrecy', 'hazel', 'macht sie runter', ''),
    ('secrecy', 'fats', 'lästert über sie', ''), ('secrecy', 'pascal', 'deckt seinen Betrug auf', ''), ('cook', 'secrecy', 'ließ nach ihr fahnden', ''),
    ('secrecy', 'ben', 'Blog-Klatsch', ''), ('secrecy', 'maisie', 'Blog-Klatsch', ''),
    # Schule
    ('mia', 'daisy', 'Patin', ''), ('mia', 'gil', 'Verehrer', '„Prinzessin Silberhaar“.'), ('mia', 'hannah', 'Klassenkameradin', ''),
    ('florence', 'callum', 'Ballpartner', ''), ('florence', 'matt', 'war mit 12 in ihn verliebt', ''),
    ('jasper', 'madison', 'Ex-Freundin', 'Sie hat Schluss gemacht.'), ('madison', 'nathan', 'Paar', ''), ('jasper', 'nathan', 'Rivalen', 'Schubst ihn in den Pool.'),
    ('gabriel', 'eric', 'Freunde', ''),
    ('lawrence', 'vanhagen', 'Affäre', ''), ('fats', 'lawrence', 'vertritt sie', ''), ('cook', 'lawrence', 'führt sie aus der Kantine', ''),
    ('henry', 'zabrinski', 'diskutiert mit ihr', ''), ('liv', 'lawrence', 'Ex-Französischlehrerin', ''),
    # Berkeley / Traum / Tiere / Sonstige
    ('liv', 'wu', 'Kung-Fu-Lehrer', 'In Berkeley; im Traum Torwächter.'), ('mia', 'wu', 'bewacht ihre Traumtür', 'Band 2.'),
    ('lindsay', 'liv', 'mobbte sie', 'Liv hat noch heute Albträume davon.'), ('lindsay', 'samantha', 'Clique', ''), ('lindsay', 'aubrey', 'Clique', ''), ('lindsay', 'abigail', 'Clique', ''),
    ('liv', 'rasmus', 'erfundener „Exfreund“', 'Eigentlich der Chow-Chow der Wakefields.'), ('henry', 'rasmus', 'war eifersüchtig', 'Bis Liv die Lüge gesteht.'),
    ('liv', 'barks', 'hat ihn ausgeführt', ''),
    ('liv', 'matt', 'übt in seinem Traum', ''), ('henry', 'matt', 'erwischt Liv in seinem Traum', ''),
    ('lottie', 'pascal', 'verliebt (Hochstapler)', ''), ('charles', 'pascal', 'lässt ihn entlarven', 'Privatdetektiv – aus Liebe zu Lottie.'),
    ('pascal', 'ann', '„plante“ die Hochzeit', ''),
    ('emily', 'tod', 'träumt ebenfalls im Korridor', ''),
]


def main():
    fid = {k: f'f-{k}' for k in F}
    keys = [c[0] for c in C]
    assert len(keys) == len(set(keys)), 'doppelte Schlüssel'
    chars = []
    for i, (k, name, short, facs, dead, place, info) in enumerate(C):
        assert all(f in F for f in facs), (k, facs)
        # Absichtlich unordentliche Startpositionen (Raster mit Versatz), damit „✨ Anordnen“ etwas zu tun hat
        x = (i % 11) * 170 + (60 if (i // 11) % 2 else 0) - 900
        y = (i // 11) * 160 + ((i * 37) % 50) - 700
        chars.append({'id': k, 'name': name, 'short': short, 'info': info, 'place': place, 'x': x, 'y': y,
                      'mapPos': None, 'factions': [fid[f] for f in facs], 'dead': dead, 'image': None})
    seen = set(); links = []
    for i, (a, b, s, lg) in enumerate(L):
        assert a in keys and b in keys, (a, b)
        p = tuple(sorted((a, b)))
        assert p not in seen, ('doppelte Verbindung', a, b)
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
