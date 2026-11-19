# History Uncle Autopilot

> **Dabartinis režimas: pusiau automatinis** (`config/brand.json` → `"publish_mode": "manual"`).
> Paspaudus ✅ botas atsiunčia paruoštas skaidres ir aprašymą, o įrašą įkeli pats (~1 min.).
> Kai bus Instagram API tokenas (`IG_ACCESS_TOKEN`), pakeisk į `"auto"`, ir įrašai bus skelbiami patys, veiks ir READ → DM.

Instagram carousel'ai, kurie gaminasi patys ir veda į Substack. Tu tik paspaudi mygtuką Telegram'e.

```
 Pirm/Tre/Penkt/Sekm ryte          Kas 15 min.                         18:15 Vilniaus laiku
 ┌──────────────────────┐   ┌──────────────────────────────┐   ┌──────────────────────────┐
 │ Claude parašo temą    │   │ Telegram: tavo mygtukai      │   │ Instagram API paskelbia  │
 │ Kritikas patikrina    │──▶│ ✅ ⚡ 🔄 ❌ arba Reply su     │──▶│ carousel'ą               │
 │ Muziejai duoda paveikslus│ │ pataisymais                  │   └──────────────────────────┘
 │ Puppeteer renderina   │   └──────────────────────────────┘   Kas 15 min.: kas parašė READ
 │ → Telegram peržiūra   │                                       komentare, gauna Substack nuorodą DM
 └──────────────────────┘
```

## Kas vyksta kiekviename juodraštyje

1. **Tema.** Pasirenkamas variklis iš `config/engines.json` (reading path, rules, difference, concepts, free resources, lessons). Paskutinės temos neperdaromos.
2. **Tekstas.** Claude rašo pagal `prompts/writer.md` (tavo redakcinės taisyklės: be brūkšnių, įvardinti istorikai, „Contested“ žymės).
3. **Ekspertinė patikra.** Antras Claude kvietimas veikia kaip priešiškas istorikas (`prompts/critic.md`). Jei randa rimtų klaidų, tekstas automatiškai perrašomas. Likusios pastabos rodomos tau Telegram'e.
4. **Nuorodos.** Visos aprašyme esančios URL patikrinamos, ar realiai veikia.
5. **Fonai pagal temą.** Rašytojas visam įrašui pasirenka stilių: klasikinė tapyba arba estetiškos nuotraukos. Kiekvienai skaidrei jis sugalvoja paiešką pagal temą (pvz. „Canaletto Grand Canal“, „Roman Forum ruins dawn“). Paveikslai imami iš Art Institute of Chicago ir The Met (tik viešasis domenas), nuotraukos iš Unsplash (nemokama licencija, galima naudoti komerciškai). Tada **Claude meno direktorius** peržiūri ~8 kandidatus ir išrenka tą, kuris atitinka temą ir yra estetiškiausias. Jei netinka nė vienas, ieško plačiau. Tas pats vaizdas niekada nepasikartoja, kreditai pridedami automatiškai.
6. **Renderis.** 1080×1350 JPEG. Visas tekstas baltas. Gradientas po tekstu nuspalvinamas tamsiu paties paveikslo atspalviu ir sustiprėja ant šviesių fonų (`templates/classical.js`).
7. **Telegram.** Gauni albumą, aprašymą, patikros rezultatus ir mygtukus.

## Telegram valdymas

| Veiksmas | Rezultatas |
|---|---|
| ✅ Patvirtinti | Išeis artimiausiu laisvu laiku (18:15 Vilniaus laiku, ne daugiau kaip 1 per dieną) |
| ⚡ Publikuoti dabar | Išeis per ~15 min. |
| 🔄 Kita tema | Atmeta ir po kelių minučių atsiunčia naują |
| ❌ Atmesti | Atmeta |
| **Reply** į juodraščio žinutę | Pataiso pagal tavo tekstą, pvz. „4 skaidrėje vietoj North įdėk Kindleberger“ arba „kitus paveikslus“ |
| `/nauja` arba `/nauja Hanzos sąjunga` | Naujas juodraštis (pasirinkta tema) |
| `/eile` | Kas laukia, kas suplanuota |

Jei laukia 3 nepatvirtinti juodraščiai, nauji nebekuriami, kad nesikauptų.

---

## Nustatymas (apie 45 min., vieną kartą)

### 1. Instagram paskyra → Creator

Instagram programėlėje: **Settings → Account type and tools → Switch to professional account → Creator**, kategorija „Education“. Sekėjai, įrašai ir viskas lieka. Facebook puslapio **nereikia**.

Į bio įdėk `historyuncle.substack.com`.

### 2. Meta developer programėlė (Instagram API)

1. Eik į [developers.facebook.com](https://developers.facebook.com) → **My Apps → Create App**.
2. Use case: **Manage messaging & content on Instagram**.
3. **API setup with Instagram login** → **Add account** → prisijunk History Uncle paskyra.
4. Leidimai: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`, `instagram_business_manage_messages`.
5. Spausk **Generate token**. Tai ilgalaikis tokenas (60 dienų, sistema pati jį atnaujina). Nusikopijuok, tai bus `IG_ACCESS_TOKEN`.

> **Svarbu apie DM funkciją.** Kol programėlė „Development“ režime, publikavimas į tavo paskyrą veikia iš karto, bet Meta leidžia siųsti DM tik žmonėms, turintiems rolę programėlėje. Kad READ → DM veiktų visiems, reikia **App Review** `instagram_business_manage_messages` leidimui (Advanced Access): trumpas ekrano įrašas, kaip veikia funkcija. Kol peržiūra nepraeis, gali `config/brand.json` nustatyti `"dm_funnel": { "enabled": false }` ir naudoti ManyChat (oficialus Meta partneris, daro tą patį). Viskas kita veikia nepriklausomai.

### 3. Telegram botas

1. Telegram'e parašyk **@BotFather** → `/newbot` → pavadink (pvz. `History Uncle Desk`). Gausi tokeną → `TELEGRAM_BOT_TOKEN`.
2. Parašyk savo naujam botui bet ką (pvz. „labas“), kad jis galėtų tau rašyti.
3. Parašyk **@userinfobot**, jis atsakys tavo ID → `TELEGRAM_CHAT_ID`.

Botas klauso **tik** tavo chat ID; kiti žmonės jo valdyti negali.

### 4. Anthropic API raktas

[console.anthropic.com](https://console.anthropic.com) → API Keys → Create Key → `ANTHROPIC_API_KEY`. Įkelk kelis dolerius kredito. Vienas juodraštis yra 2–4 modelio kvietimai, tad per mėnesį tai keli eurai. Pigiau: `config/brand.json` → `model.writer` ir `model.critic` pakeisk į `claude-sonnet-5-5`.

### 5. GitHub repozitorija

1. Sukurk **viešą** (public) repozitoriją, pvz. `history-uncle-autopilot`, ir įkelk šiuos failus (*Add file → Upload files*, arba `git push`).
   *Kodėl viešą:* Instagram API paveikslus pasiima tik iš viešo URL, o viešoms repozitorijoms GitHub Actions nemokamas be limito. Slapti raktai lieka paslėpti Secrets skiltyje. Kompromisas: patvirtintus, bet dar nepaskelbtus juodraščius repozitorijoje teoriškai kas nors gali pamatyti anksčiau.
2. **Settings → Secrets and variables → Actions → New repository secret**, sukurk:

   | Secret | Iš kur |
   |---|---|
   | `ANTHROPIC_API_KEY` | 4 žingsnis |
   | `TELEGRAM_BOT_TOKEN` | 3 žingsnis |
   | `TELEGRAM_CHAT_ID` | 3 žingsnis |
   | `IG_ACCESS_TOKEN` | 2 žingsnis |
   | `UNSPLASH_ACCESS_KEY` | [unsplash.com/developers](https://unsplash.com/developers) → New Application → *Access Key*. Be jo sistema naudos tik paveikslus. |
   | `GH_PAT` | [github.com/settings/tokens](https://github.com/settings/personal-access-tokens) → Fine-grained token → tik ši repozitorija → *Secrets: Read and write*. Reikalingas automatiniam Instagram tokeno atnaujinimui. |

3. **Settings → Actions → General → Workflow permissions → Read and write permissions** → Save.

### 6. Pirmas paleidimas

**Actions → Draft carousel → Run workflow.** Gali įrašyti variklį (`free-resources`) ar temą. Po ~3 minučių Telegram'e gausi pirmą juodraštį. Nuo tada viskas vyksta pagal grafiką.

---

## Derinimas

| Ką keisti | Kur |
|---|---|
| Kiek kartų per savaitę | `.github/workflows/draft.yml` → `cron` (dabar Pirm, Tre, Penkt, Sekm) |
| Publikavimo valanda | `config/brand.json` → `schedule.publish_hour_local` |
| Temų kryptys ir jų dažnis | `config/engines.json` (`weight`) |
| Redakcinės taisyklės, tonas | `prompts/writer.md` |
| Ką tikrina kritikas | `prompts/critic.md` |
| DM tekstas, raktinis žodis | `config/brand.json` → `dm_funnel` |
| Dizainas | `templates/classical.js` |
| Instagram handle | `config/brand.json` → `instagram_handle` |

Vietinė peržiūra savo kompiuteryje (reikia Node 20+ ir Chrome):

```bash
npm install
npm run preview                  # samples/sample-post.json → preview/slides/
node src/cli.js preview samples/sample-post.json --art   # su tikrais muziejų paveikslais
npm test
```

## Failų struktūra

```
config/            brand.json, engines.json
prompts/           writer.md, critic.md
templates/         classical.js (dizainas)
src/
  generate.js      Claude rašytojas + kritikas + nuorodų patikra
  art.js           AIC + Met viešojo domeno paieška
  render.js        Puppeteer → JPEG
  telegram.js      patvirtinimo pultas
  instagram.js     publikavimas, DM funnel, tokeno atnaujinimas
  pipeline.js      juodraščio ciklas ir grafikas
  cli.js           komandos (draft, tick, preview, refresh-token)
state/             eilė, istorija, juodraščiai (commit'inama automatiškai)
.github/workflows/ draft.yml, tick.yml, refresh-token.yml
```
