# Instruktioner för publicering

Detta repo är den kanoniska källan för `https://hktcr.github.io/explorations/`.

Före publicering ska den gemensamma rutinen i `hktcr/gaia-tools/PUBLICERINGSRUTIN.md` läsas och följas. Den anslutna GitHub-appen är primär skrivväg när den har skrivrätt. Saknad `gh` är inte ett hinder i det läget.

Kör alltid följande före publicering:

```sh
node scripts/inject-reader-settings.cjs
python3 scripts/build_search_index.py
node scripts/validate-network.cjs
node --test
```

Alla essäer som länkas från `index.html` ska ladda exakt en version av det gemensamma
läsarlagret i `reader-settings.css` och `reader-settings.js`. Lägg inte till nya lokala
varianter av sökning, teckenstorlek, typsnitt, radbredd, tema, utskrift, läsprogression
eller ljudspelare. Kör injiceringsskriptet efter att en essä har lagts till eller ändrats.
Kommentarer och reflektioner hanteras fortsatt separat av `engagement/` och får inte
tas bort eller ersättas av läsarlagret.

Publicera hela releasen som en enda atomisk commit mot en verifierat oförändrad `main`. Använd aldrig `force`. Kontrollera därefter den verkliga Pages-adressen. En lokal commit eller en uppdaterad `main` får inte kallas verifierad publicering innan den publika sidan har lästs tillbaka och kärnfunktionerna har provats.

Portalens titellista använder verifierade Pages-tider. Den ordinarie indexbyggaren registrerar nya publicerade titlar från formatens kataloger. Markera en avsiktlig sakrevision med `python3 scripts/portal_latest.py --updated SECTION PUBLIC_PATH` före släppet. Använd sedan `python3 scripts/portal_publication_receipt.py COMMIT` i det ordinarie kvittosteget för att verifiera samtliga nya händelser i släppet och publicera den genererade tidsprojektionen enligt samma rutin. En teknisk malländring är ingen sakrevision.

## Underhåll av källbiblioteket

Vid registrering eller rättelse köas källan för nästa ordinarie underhåll. Registrera stabil identitet (DOI eller verifierad kanonisk adress), senast belagda ändring, åtkomstklass, kategori, ämnestaggar, språkalias och en kort verifierad beskrivning. Registrera endast belagda användningar och deras returlänkar. Saknade datum eller beskrivningar får stå som okända. Den publika projektionen använder endast fält som stöds av det godkända schemat och offentliga bibliografiska metadata.

Stäm av alla registrerade inflöden minst tre gånger per vecka. Jämför varje samlings ändringsmarkör och varje berörd posts version med senaste verifierade genomgång. Granska nya och ändrade poster samt fel där förutsättningarna har ändrats. Matcha på stabil identitet före införande. Vid rättelse, indragning eller ändrad åtkomst spåras berörda användningar och korrigeras i samma projektion. Ett återkommande fel behåller sin undantagspost tills ny evidens finns. Flytta kontrollmarkören först efter verifierad behandling eller dokumenterat undantag.

Bygg berörda sökindex, källnät och underlag för taggmolnet från samma godkända version. Kontrollera identitet, antal, ämnesfilter och belagda returlänkar mot den serverade versionen. En fristående bibliografisk post kan ha noll användningar.
