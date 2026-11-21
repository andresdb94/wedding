# Backend RSVP (Google Sheets + Apps Script)

Gli invitati cercano il proprio invito in un elenco (il vostro Google Sheet degli invitati), rispondono dal sito
e le risposte finiscono in un foglio di raccolta. Se lasciano l'email, ricevono un riepilogo.

## Formato dell'elenco invitati

Il foglio ha una riga per invito e queste colonne (la prima riga è l'intestazione):

| Invitati | N. persone | N. Bambini 3-10 anni | N. Bambini 0-3 |
|---|---|---|---|
| Carlo, Ilva, Gabriele e Noah | 2 | 1 | 1 |

- I nomi sono separati da virgole, da " e " o da " & ", **in ordine di età**: prima gli adulti, poi i bambini 3-10, poi gli 0-3.
- "N. persone" è il numero di **adulti**. Se in una riga contiene il totale, lo script ricava gli adulti per differenza.
- **Solo taglio della torta:** inserisci una riga con il testo `DA QUA SOLO AL TAGLIO DELLA TORTA` nella colonna A.
  Tutti gli inviti sotto quella riga sono considerati senza pranzo: confermano solo la presenza, senza allergie,
  e nel riepilogo sono contati a parte. Gli inviti sopra la riga sono a pranzo.
- Le righe in cui i numeri non quadrano con i nomi vengono ignorate: le trovi con **RSVP → Controlla elenco invitati**.
- Se due inviti hanno esattamente lo stesso testo nella colonna A, viene usato solo il primo. Rendili diversi (per esempio aggiungendo il cognome).

L'ID del foglio è in `GUEST_SHEET_ID` all'inizio di `Code.gs`. Per usare un'altra scheda del file, imposta `GUEST_SHEET_NAME`.

## Installazione (circa 10 minuti)

1. Crea un nuovo **Google Sheet** per le risposte (per esempio "RSVP Matrimonio"). Deve essere un file diverso dall'elenco.
2. **Estensioni → Apps Script**. Cancella il contenuto di `Code.gs` e incolla quello di [Code.gs](./Code.gs).
3. (Facoltativo) Imposta `NOTIFY_EMAIL` con la tua email per ricevere una notifica a ogni risposta.
4. Dal menu a tendina delle funzioni scegli **`setup`** e premi **Esegui**. Autorizza l'accesso quando richiesto
   (lo script deve poter leggere l'elenco invitati, quindi usa un account che lo vede, e inviare email).
   Vengono creati i fogli **Risposte** e **Riepilogo**.
5. Esegui **`controllaElenco`** e verifica che gli inviti e le persone siano quelli attesi.
6. **Distribuisci → Nuova distribuzione → tipo "App web"**:
   - *Esegui come*: **Me**
   - *Chi ha accesso*: **Chiunque**
7. Copia l'**URL dell'app web** (finisce con `/exec`). Aprilo nel browser: deve mostrare `{"ok":true,"service":"rsvp"}`.
8. In [index.html](../index.html) sostituisci `INCOLLA_QUI_URL_WEB_APP` con quell'URL.
9. Prova il form dal sito e controlla che le righe arrivino nel foglio **Risposte**.

> Ogni volta che modifichi `Code.gs` devi creare una **nuova versione** della distribuzione
> (Distribuisci → Gestisci distribuzioni → modifica → Nuova versione), altrimenti il sito usa il codice vecchio.

## Come funziona

- **Ricerca:** l'invitato scrive almeno 3 lettere e vede al massimo 8 inviti. Il browser non scarica mai l'intero elenco.
- **Nessun +1 non previsto:** nomi e fasce d'età vengono sempre dall'elenco, anche lato server. Non si possono aggiungere,
  togliere o cambiare persone, né le fasce.
- **Modifiche all'elenco:** compaiono sul sito entro 5 minuti (cache).
- **Risposte:** una riga per persona. Colonne: data, ID invio, invito, tipo (Pranzo / Solo torta), telefono, email, nome, partecipa, fascia, allergie, note, valida.
- **Riepilogo:** presenze a pranzo, per fascia (adulti, bambini 3-10, 0-3), numero di persone con allergie (solo pranzo), più le presenze al solo taglio della torta. Conta solo le righe con `Valida = Sì`.
- **Correzioni:** se un invito risponde di nuovo, le righe precedenti passano a `No (sostituita)` e restano come storico.
  Il sito avvisa l'invitato quando sta ripetendo una risposta.
- **Chi non ha risposto:** menu **RSVP → Aggiorna "Da rispondere"** scrive nel foglio *Da rispondere* gli inviti senza risposta.
- **Allergie:** filtra la colonna *Allergie* (non vuota) e *Valida* = Sì.

## Note

- L'email parte dal tuo account Google. Il limite è di circa 100 email al giorno per un account gratuito, ampiamente sufficiente.
- Il campo nascosto `website` nel form funge da trappola anti-spam: le richieste che lo compilano vengono ignorate.
- L'elenco contiene solo nomi di battesimo e la ricerca mostra gli inviti che corrispondono: chi prova molte combinazioni di
  lettere potrebbe scoprire alcuni inviti. Per un sito condiviso solo con gli invitati il rischio è basso.
