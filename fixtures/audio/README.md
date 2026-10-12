# Narration fixture audio

The audio here is **not committed**. Fetch it with:

```bash
npm run fixtures:audio
```

The script (`fixtures/scripts/download-audio.mjs`) downloads the files one at a time from archive.org into `fixtures/audio/alice/`, checks each against a SHA-256 recorded in the script, and skips files that are already present and correct.

## Recording

| Field         | Value                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Work          | _Alice's Adventures in Wonderland_, Lewis Carroll (1865)                                                               |
| Recording     | LibriVox, solo reading by **Kara Shallenberg**                                                                         |
| archive.org   | [`alices_adventures_1003`](https://archive.org/details/alices_adventures_1003)                                         |
| Licence       | Public domain. LibriVox recordings are dedicated to the public domain by their readers; the text is public domain too. |
| Format        | MP3, 64 kbps, 22.05 kHz, mono                                                                                          |
| Files fetched | Chapters 1–3 only                                                                                                      |

| Chapter                          | File                                    | Duration | Bytes     |
| -------------------------------- | --------------------------------------- | -------- | --------- |
| 1. Down the Rabbit-Hole          | `alices_adventures_01_carroll_64kb.mp3` | 13:16    | 6,371,811 |
| 2. The Pool of Tears             | `alices_adventures_02_carroll_64kb.mp3` | 12:55    | 6,202,326 |
| 3. A Caucus-Race and a Long Tale | `alices_adventures_03_carroll_64kb.mp3` | 10:32    | 5,061,100 |

## Text edition (intentional mismatch)

The reader worked from her own source text, which may differ from the Project Gutenberg text in `apps/web/static/books/alice.epub` (ebook #11) and the Standard Ebooks edition in `fixtures/epub/alice-standard-ebooks.epub`: punctuation, spelling, the odd word, and the spoken LibriVox preamble and closing at the start and end of each chapter, which are not in any text. That is intentional. DESIGN.md §12.2 wants a different source edition so the alignment tests meet realistic text/audio mismatches.
