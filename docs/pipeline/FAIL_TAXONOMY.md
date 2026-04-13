# ZLE Pipeline Fail Taxonomy

Definitivní klasifikace selhání pipeline:
source → curate → review → stage → publish-gate → publish → sanitize

Každé selhání má:
- typ (classification)
- důvod (root cause)
- řešení (actionable next step)

Fail taxonomy slouží jako:
- debug mapa
- operační manuál
- prevence opakovaných chyb

## Core Principles

- Fail-closed: pokud chybí artifact → pipeline nesmí pokračovat
- Artifact > log: existence JSON neznamená validní stav (může to být failure wrapper)
- Jeden runId = jeden chain
- tmp/ je source of truth pro běh pipeline
- Downstream nikdy nesmí používat failure wrapper jako validní input

## Failure Structure

Každý fail má formát:

### <CODE> — <NÁZEV>

Typ: <classification>
Důvod:
<co přesně se rozbilo>

Detection:
- ...
- ...

Stop rule:
- ...

Actionable next step:
<konkrétní kroky co udělat>

## Review Fails

### R1 — Missing review manifest

Typ: artifact-missing
Důvod:
Review krok očekává review manifest, ale artifact neexistuje.

Detection:
- Chybí soubor `tmp/review-decisions/<runId>.review.json`.
- Upstream `curate` pro stejný `runId` skončil bez failure, ale review artifact nebyl vytvořen.

Stop rule:
- Pokud je explicitně zadán `--review-run-id`, pipeline musí zastavit (fail-closed), dokud review manifest nevznikne pro stejný `runId`.
- Pokud `--review-run-id` není explicitní a všechny curated položky mají `requiresHumanReview=false`, pipeline může pokračovat přes auto-approved bridge.

Actionable next step:
Zkontrolovat review-queue output a ověřit, že review artifact byl vygenerován a uložen do tmp/ pro stejný runId.

### R2 — Review manifest shape mismatch

Typ: schema-invalid
Důvod:
Review manifest existuje, ale neodpovídá očekávané struktuře (chybějící pole, špatné typy, nevalidní payload).

Detection:
- `tmp/review-decisions/<runId>.review.json` existuje, ale chybí klíče `runId`, `createdAt`, `sourceRunId` nebo `decisions`.
- V `decisions[]` chybí povinná pole `sourceProductKey` / `decision` / `resolutionType` nebo mají nevalidní hodnoty.

Stop rule:
- Pipeline musí zastavit; pokračování je povoleno až po validním schema pass.

Actionable next step:
Spustit validaci schématu manifestu, opravit generátor review artifactu a rerun s novým runId.

### R3 — Empty review queue vs flow mismatch

Typ: flow-inconsistent
Důvod:
Review queue je prázdná, ale zbytek flow implikuje, že položky měly být předány do review.

Detection:
- `tmp/review-decisions/<runId>.review.json` má `decisions: []`, ale `curate` output pro stejný `runId` obsahuje review-eligible kandidáty.
- Review queue report indikuje `accepted > 0`, zatímco review decision set je prázdný.

Stop rule:
- Může pokračovat pouze jako explicitní no-op, pokud je prázdná queue očekávaná a auditně potvrzená.
- Pokud `accepted > 0`, pipeline musí zastavit (flow mismatch).

Actionable next step:
Porovnat vstup curate a výstup review-queue, potvrdit jestli jde o legitimní no-op; pokud ne, opravit filtraci nebo routing.

### R4 — Explicit review run without artifact

Typ: operator-orchestration-error
Důvod:
Byl spuštěn explicitní review run, ale neexistuje odpovídající review artifact.

Detection:
- Log obsahuje explicitní spuštění review pro `runId`, ale `tmp/review-decisions/<runId>.review.json` neexistuje.
- Následující krok čte fallback/failure wrapper místo review artifactu.

Stop rule:
- Pipeline musí zastavit; explicitní bridge je povolen jen po ručním vytvoření validního artifactu pro stejný `runId`.

Actionable next step:
Zastavit downstream kroky, dohledat chybějící artifact pro daný runId nebo spustit review znovu korektní cestou.

## Stage Fails

### S1 — Failure wrapper místo staging manifestu

Typ: failure-wrapper-consumed
Důvod:
Stage načetl JSON, který je failure wrapper, ne validní staging manifest.

Detection:
- Soubor `tmp/agent-manifests/<runId>.staging.json` obsahuje `"status": "failed"`.
- Manifest obsahuje `"failureCode": "missing_required_artifact"` nebo analogický error payload.

Stop rule:
- Pipeline musí zastavit okamžitě; downstream nesmí wrapper interpretovat jako validní manifest.

Actionable next step:
Detekovat wrapper podle status/error signatur, failnout run a vrátit se na upstream krok, který wrapper vytvořil.

### S2 — Approved 0 / staged 0

Typ: empty-transition
Důvod:
Stage neobdržel žádné schválené položky a nic nestageoval; může jít o no-op nebo chybný tok.

Detection:
- Stage metrics hlásí `approved: 0` a `staged: 0`.
- Review/curate upstream pro stejný `runId` ukazuje `accepted > 0`.

Stop rule:
- Pokud `accepted = 0`, může pokračovat jako explicitní no-op.
- Pokud `accepted > 0` a `approved/staged = 0`, pipeline musí zastavit (orchestration bug).

Actionable next step:
Ověřit, zda accepted/approved vstupy skutečně měly být > 0; pokud ano, vyšetřit review rozhodování a mapování stavů.

### S3 — Missing upstream artifact

Typ: artifact-missing
Důvod:
Stage krok nemá dostupný upstream artifact (typicky review output) pro aktuální runId.

Detection:
- Chybí `tmp/review-decisions/<runId>.review.json` před spuštěním stage.
- Stage log obsahuje `missing upstream artifact` nebo ekvivalentní chybu načtení.

Stop rule:
- Pipeline musí zastavit; bez upstream artifactu není povolen žádný fallback.

Actionable next step:
Prověřit existenci artifactu v tmp/, konzistenci runId a pořadí kroků; bez artifactu stage neprovádět.

### S4 — Temp-only manifest (nepersistovaný)

Typ: persistence-failure
Důvod:
Manifest existuje jen dočasně v procesu, ale nebyl perzistován jako artifact pro downstream.

Detection:
- Stage log hlásí úspěšné sestavení manifestu, ale `tmp/agent-manifests/<runId>.staging.json` po kroku neexistuje.
- Následující krok selže na file-not-found při čtení staging manifestu.

Stop rule:
- Pipeline musí zastavit; pokračování je povoleno až po potvrzené persistenci manifestu.

Actionable next step:
Opravit persistenci staging manifestu, přidat kontrolu existence souboru po zápisu a rerun.

## Publish-Gate Fails

### G1 — Missing publish-gate manifest

Typ: artifact-missing
Důvod:
Publish-gate krok nemá svůj manifest a nemůže rozhodnout o průchodu do publish.

Detection:
- Chybí `tmp/publish-gates/<runId>.publish-gate.json`.
- Stage manifest existuje, ale gate output pro stejný `runId` nebyl vytvořen.

Stop rule:
- Pipeline musí zastavit; publish bez gate manifestu není povolen.

Actionable next step:
Zastavit publish, obnovit nebo znovu vygenerovat gate manifest z validního stage outputu.

### G2 — Invalid gate schema

Typ: schema-invalid
Důvod:
Gate manifest má nevalidní schéma nebo chybí klíčové rozhodovací pole.

Detection:
- `tmp/publish-gates/<runId>.publish-gate.json` chybí povinné top-level pole `runId`, `sourceRunId`, `reviewRunId`, `stagingRunId`, `createdAt`, `summary` nebo `items`.
- V `items[]` chybí `releaseDecision` nebo `eligibilityStatus`, případně hodnoty nejsou v povoleném enumu.

Stop rule:
- Pipeline musí zastavit; pokračování je povoleno až po validním gate schema pass.

Actionable next step:
Spustit schema validaci gate artifactu, opravit serializaci a znovu spustit gate krok.

### G3 — Empty staged set (no-op vs fail)

Typ: decision-ambiguity
Důvod:
Staged set je prázdný a není jasné, zda jde o očekávaný no-op nebo selhání toku.

Detection:
- Gate input ukazuje prázdné staged `items: []`.
- Upstream stage summary současně hlásí `accepted > 0`, ale staged set je 0.

Stop rule:
- Pokud upstream potvrzuje legitimní no-op (`accepted = 0`), může pokračovat jako no-op.
- Pokud `accepted > 0` a staged set je prázdný, pipeline musí zastavit.

Actionable next step:
Aplikovat explicitní pravidlo no-op/fail pro daný pipeline režim a výsledek zaznamenat do gate manifestu.

## Publish Fails

### P1 — Missing publish report

Typ: artifact-missing
Důvod:
Publish krok doběhl bez vytvoření publish reportu, takže downstream nemá auditovatelný výsledek.

Detection:
- Chybí `tmp/publish-reports/<runId>.publish.json` po doběhu publish kroku.
- Publish log hlásí success, ale report path neobsahuje artifact pro stejný `runId`.

Stop rule:
- Pipeline musí zastavit; bez publish reportu nesmí běžet sanitize ani další downstream.

Actionable next step:
Považovat run za failed, zjistit proč report nevznikl, opravit report generation a rerun publish.

### P2 — Validate-only fail

Typ: validation-failure
Důvod:
Run v režimu validate-only selhal na validačních pravidlech před samotným publish.

Detection:
- `tmp/publish-reports/<runId>.publish.json` má v `debug.errorStage` hodnotu `validation`.
- `summary.failed > 0` a v `items[]` existují položky se `status: "failed"` a validačními `reasonCodes`.

Stop rule:
- Pipeline musí zastavit publish část; pokračovat lze pouze po opravě validačních chyb a novém běhu.

Actionable next step:
Opravit validační chyby na vstupu, potvrdit že validate-only prochází, až poté spustit ostrý publish.

### P3 — Publish success but downstream fail

Typ: downstream-integration-failure
Důvod:
Publish proběhl úspěšně, ale navazující krok (např. sanitize) selhal a chain je nekonzistentní.

Detection:
- `tmp/publish-reports/<runId>.publish.json` obsahuje successful publish (`status: success`/ekvivalent).
- Následující krok vrací `"status": "failed"` pro stejný `runId`.

Stop rule:
- Pipeline musí zastavit chain a přejít do recovery režimu; publish se neopakuje bez potvrzení idempotence.

Actionable next step:
Fixnout downstream failure, potvrdit idempotenci publish výsledku a dokončit chain bez opakovaného duplicitního publish.

## Sanitize Fails

### C1 — Missing live snapshot

Typ: dependency-missing
Důvod:
Sanitize potřebuje live snapshot, který není dostupný pro aktuální run.

Detection:
- Chybí `tmp/catalog-sanitize/live-products.<runId>.json`.
- Sanitize log vrací chybu typu `missing live snapshot`.

Stop rule:
- Pipeline musí zastavit; sanitize nesmí pokračovat bez snapshotu.

Actionable next step:
Obnovit nebo znovu vytvořit snapshot, ověřit runId vazbu a sanitize spouštět až po dostupnosti snapshotu.

### C2 — Missing publish report

Typ: dependency-missing
Důvod:
Sanitize nemá publish report, takže nemůže určit co bylo publikováno.

Detection:
- Chybí `tmp/publish-reports/<runId>.publish.json`.
- Sanitize input loader končí na `missing publish report` nebo `failureCode: missing_required_artifact`.

Stop rule:
- Pipeline musí zastavit; sanitize může pokračovat až po dostupném publish reportu.

Actionable next step:
Vrátit se na publish, zajistit validní publish report a teprve poté opakovat sanitize.

### C3 — DB auth fail

Typ: environment-auth-failure
Důvod:
Sanitize se nepřipojí do DB kvůli nevalidním přihlašovacím údajům nebo právům.

Detection:
- DB klient vrací auth chyby (`authentication failed`, `access denied`, `invalid credentials`).
- Sanitize krok failne před jakoukoliv mutací dat.

Stop rule:
- Pipeline musí zastavit; pokračování je povoleno až po úspěšném DB auth testu.

Actionable next step:
Zkontrolovat DB credentials, role a síťový přístup; po opravě provést rerun sanitize.

## Env Fails

### E1 — tmp deleted

Typ: runtime-environment-loss
Důvod:
Adresář tmp/ byl smazán nebo vyčištěn během chainu a artifacts zmizely.

Detection:
- Očekávané artifact paths (`tmp/review-decisions/...`, `tmp/agent-manifests/...`) náhle neexistují.
- Více kroků selže současně na file-not-found pro stejný `runId`.

Stop rule:
- Pipeline musí zastavit; žádný bridge/fallback bez kompletní obnovy artifactů.

Actionable next step:
Zastavit chain, obnovit prostředí, zavést ochranu tmp/ lifecycle a spustit celý run znovu.

### E2 — Node version mismatch

Typ: runtime-version-mismatch
Důvod:
Verze Node.js neodpovídá očekávané verzi pipeline a způsobuje nekompatibilitu.

Detection:
- Runtime hlásí unsupported engine/ABI mismatch proti požadované Node verzi projektu.
- Stejný run selhává konzistentně na startu kroku napříč pipeline stadii.

Stop rule:
- Pipeline musí zastavit; pokračovat lze až po sjednocení Node verze v runtime/CI.

Actionable next step:
Sjednotit Node verzi podle projektu (toolchain/CI), ověřit build/runtime a rerun.

### E3 — DB config fail

Typ: environment-config-error
Důvod:
Pipeline používá nevalidní nebo neúplnou DB konfiguraci.

Detection:
- Chybí povinné config hodnoty (`host`, `port`, `db`, `user`) nebo jsou nevalidní.
- Connection test vrací config parse/resolve error před autentizací.

Stop rule:
- Pipeline musí zastavit; pokračovat lze až po validním config + úspěšném connection testu.

Actionable next step:
Opravit konfiguraci (host, port, db, ssl, creds), validovat connection testem a zopakovat krok.

## Operátorské Chyby

### O1 — RunId mismatch

Typ: operator-error
Důvod:
Kroky chainu pracují s různými runId a artifacts nepatří do stejného běhu.

Detection:
- `runId` v `tmp/review-decisions/<runId>.review.json`, `tmp/agent-manifests/<runId>.staging.json` a `tmp/publish-reports/<runId>.publish.json` se neshoduje.
- Logy obsahují mix více runId v jednom execution chainu.

Stop rule:
- Pipeline musí zastavit; pokračování je povoleno až po sjednocení všech kroků na jedno `runId`.

Actionable next step:
Sjednotit runId ve všech příkazech, smazat cizí artifacts z kontextu a zopakovat chain konzistentně.

### O2 — Failure wrapper misinterpretace

Typ: operator-error
Důvod:
Operátor nebo skript interpretoval failure wrapper jako úspěšný artifact.

Detection:
- JSON obsahuje `"status": "failed"` nebo `"failureCode"`, ale byl předán jako validní input downstream.
- Následný krok selže na chybějících doménových polích očekávaných u success artifactu.

Stop rule:
- Pipeline musí zastavit okamžitě; explicitní bridge je nepovolen, dokud není wrapper nahrazen validním artifactem.

Actionable next step:
Zavést explicitní kontrolu wrapper signatur před parsováním a failnout okamžitě při detekci error payloadu.

## Debug Flow (Always Follow)

1. Je artifact validní nebo failure wrapper?
2. Sedí runId napříč kroky?
3. Není to legitimní no-op?
4. Nechybí upstream artifact?
5. Není to jen environment problém?

## Minimal Execution Map

Review:
- manifest chybí → check review-queue
- explicit review → bez manifestu fail

Stage:
- approved 0 + accepted > 0 → bug

Gate:
- status=failed → vrátit se zpět

Publish:
- bez publish reportu nepokračovat

Sanitize:
- potřebuje publish + snapshot
