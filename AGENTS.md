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
