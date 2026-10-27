# Det granskade essänätverket

Nätverket publicerar kunskapsrelationer, inte automatisk ordlikhet. En publik kant måste finnas i `relations-curated.json`, ha status `reviewed`, en tillåten relationstyp, en konkret motivering och specifika gemensamma begrepp.

`scripts/build_search_index.py` läser bibliotekskorten, essäerna och den granskade relationsfilen. Den skapar deterministiskt `sok-index.json` och `natverk-index.json`. Kör därefter `node scripts/validate-network.cjs` och `node --test`.

Gränssnittet är byggt med progressiv förbättring. Kortvyn och en enklare kortsökning fungerar även om ett index inte kan laddas. Nätverket kräver aldrig hovring. Noder har minst 44 pixlars tryckyta, tangentbordsstöd, reducerad rörelse och ett listbaserat relationsalternativ.

Nätverkssidans sökning matchar alla sökord mot titel, ämne och essä-id. Direkta träffar får en heldragen ring och en text som anger vilka metadatafält som matchar. Bara deras redan granskade, direkta samband framhävs; kopplade essäer får en streckad ring. Ett separat nodval öppnar relationstyper och motiveringar utan att ersätta sökmarkeringarna. Sökningen skapar, graderar eller vetenskapligt omvärderar inga relationer och använder inte startsidans separata fulltextsökning.

En lugn ringpuls (4,8 sekunder) och ett jämnt fram-och-tillbaka-flöde (8 sekunder) visar sökfokus. Rörelsens hastighet och linjebredd beror inte på textrelevans. Pausknappen, `prefers-reduced-motion` och en dold flik stoppar rörelsen; ringar, listinformation och relationstyper finns kvar. Layouten beräknas före målning och canvas ändrar storlek endast när måtten ändras. Sökfrågan sparas i URL-parametern `q`; nodval sparas i fragmentet och kan återbesökas med bakåt/framåt. Escape rensar först sökningen, därefter nodvalet. ”Visa hela nätverket” rensar båda.

`tests/natverk-search.test.js` använder en syntetisk graf för att pröva metadata, granskade relationer, nollresultat, nodval, historik, paus och reducerad rörelse. DOM-testerna ersätter inte renderad webbläsarprovning. UI-resursernas separata `ui`-cacheparameter ändrar inte det befintliga indexkontraktets release-id.

Responsivitetskontraktet omfattar moderna Chrome, Edge, Firefox och Safari på aktuella versioner av Windows, macOS, Linux, ChromeOS, Android, iOS och iPadOS. Layouten har särskilda lägen för högst 390 pixlar, högst 700 pixlar och minst 900 pixlar. Äldre eller ovanliga webbläsare ska fortfarande behålla den grundläggande kortvyn.

Publicering följer den gemensamma rutinen i `hktcr/gaia-tools/PUBLICERINGSRUTIN.md`. Detta repo är den kanoniska Pages-källan. En saknad lokal GitHub CLI är inte ett publiceringshinder när den anslutna GitHub-appen har skrivrätt.
