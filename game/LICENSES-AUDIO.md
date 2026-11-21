# LICENSES-AUDIO — Inventário, Proveniência e Loudness de Áudio (Fase 2F: T2.22 & T2.23)

Este documento registra a proveniência, autoria, licença, receita acústica, duração, tamanho em bytes/KB e medição EBU R128 (`ffmpeg -af ebur128=peak=true`) de todos os **32 arquivos de áudio** da fatia vertical (**30 SFX comuns** em `static/sounds/common/` + **2 ambiências de Origens** em `static/sounds/origens/`).

## 1. Política de Originalidade e Licenciamento (R8)

- **100% First-Party Procedural / Foley Acústico Original:** Todos os 32 arquivos são gerados deterministicamente a partir de `game/scripts/build-audio.py` (sementes fixas de RNG, síntese modal multi-corpo, cordas dedilhadas Karplus-Strong, ruído rosa/marrom filtrado por formantes, convolução de reflexões iniciais e harmonias em Ré Mixolídio / Baião).
- **Zero bytes de terceiros:** Nenhum arquivo, amostra ou contorno melódico provém de repositórios de referência ou de jogos comerciais.
- **Licença de distribuição:** `CC0-1.0 OR MIT` — autoria original de **Victor Neves (`voaneves`)**, verificável e reproduzível localmente via `python scripts/build-audio.py`.
- **Nota sobre Música (Decisão D4 — PLAN-3D §9.2):** Conforme a seção 9.2 (D4) e T2.22 do plano, os stems de música de fundo permanecem omitidos na fatia vertical até decisão formal D4 do proprietário (sendo excluídos da pontuação de música do Gate G2 enquanto D4 estiver em padrão sem música). A camada harmônica diegética já está presente na respiração de sanfona de `amb_cerrado_dawn.mp3`, no bordão de `grind_loop.mp3` e nos 3 dedilhados `line_pluck_01..03.mp3` afinados em Ré Mixolídio.

## 2. Resumo de Orçamento e Normalização (Gate `check-size` / T2.23)

| Lote / Pasta | Arquivos | Tamanho (Bytes) | Tamanho (KB) | Orçamento Alvo | Status |
|---|---:|---:|---:|---:|---|
| `static/sounds/common/` (SFX Base) | 30 | 100,289 B | **97.94 KB** | ≤ 400.00 KB | PASS |
| `static/sounds/origens/` (Ambiências Era 1) | 2 | 188,708 B | **184.29 KB** | ≤ 350.00 KB | PASS |
| **Total Combinado (`audio` budget)** | **32** | **288,997 B** | **282.22 KB** | **≤ 750.00 KB** | **PASS** |

- **True Peak máximo medido (`ffmpeg -af ebur128=peak=true`):** `-2.60 dBTP` (limite exigido: `≤ -1.0 dBTP`).
- **Taxa de amostragem / formato:** MP3 (`libmp3lame`), 44.1 kHz, Mono, 64 kbps CBR sem cabeçalhos ID3/Xing supérfluos.

## 3. Tabela Completa de Arquivos (30 SFX + 2 Ambiências)

| # | Arquivo (`static/sounds/…`) | Categoria | Duração (s) | Tamanho (KB) | Loudness (LUFS / dBTP) | Autor / Fonte (URL / Script) | Licença |
|---:|---|---|---:|---:|---|---|---|
| 1 | `common/step_laterite_01.mp3` | common / Locomoção (Terra Laterita) | 0.25 s | 2.24 KB (2298 B) | `-19.5 LUFS` / `-3.60 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Síntese modal de impacto de sola em laterita + cluster granular de cascalho (var. 1, seed 1073)) | CC0-1.0 / MIT |
| 2 | `common/step_laterite_02.mp3` | common / Locomoção (Terra Laterita) | 0.24 s | 2.24 KB (2298 B) | `-21.5 LUFS` / `-3.90 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Síntese modal de impacto de sola em laterita + cluster granular de cascalho (var. 2, seed 1146)) | CC0-1.0 / MIT |
| 3 | `common/step_laterite_03.mp3` | common / Locomoção (Terra Laterita) | 0.25 s | 2.24 KB (2298 B) | `-18.9 LUFS` / `-3.20 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Síntese modal de impacto de sola em laterita + cluster granular de cascalho (var. 3, seed 1219)) | CC0-1.0 / MIT |
| 4 | `common/step_laterite_04.mp3` | common / Locomoção (Terra Laterita) | 0.24 s | 2.24 KB (2298 B) | `-19.7 LUFS` / `-3.50 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Síntese modal de impacto de sola em laterita + cluster granular de cascalho (var. 4, seed 1292)) | CC0-1.0 / MIT |
| 5 | `common/step_grass_01.mp3` | common / Locomoção (Capim do Cerrado) | 0.26 s | 2.24 KB (2298 B) | `-18.5 LUFS` / `-3.20 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Fricção fibrosa multi-banda de capim seco + impacto macio de solo (var. 1, seed 2089)) | CC0-1.0 / MIT |
| 6 | `common/step_grass_02.mp3` | common / Locomoção (Capim do Cerrado) | 0.26 s | 2.24 KB (2298 B) | `-20.3 LUFS` / `-2.80 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Fricção fibrosa multi-banda de capim seco + impacto macio de solo (var. 2, seed 2178)) | CC0-1.0 / MIT |
| 7 | `common/step_grass_03.mp3` | common / Locomoção (Capim do Cerrado) | 0.26 s | 2.24 KB (2298 B) | `-19.5 LUFS` / `-3.90 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Fricção fibrosa multi-banda de capim seco + impacto macio de solo (var. 3, seed 2267)) | CC0-1.0 / MIT |
| 8 | `common/step_grass_04.mp3` | common / Locomoção (Capim do Cerrado) | 0.26 s | 2.24 KB (2298 B) | `-20.2 LUFS` / `-4.10 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Fricção fibrosa multi-banda de capim seco + impacto macio de solo (var. 4, seed 2356)) | CC0-1.0 / MIT |
| 9 | `common/step_wood_01.mp3` | common / Locomoção (Madeira) | 0.23 s | 2.04 KB (2089 B) | `-18.5 LUFS` / `-3.30 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Banco modal ortotrópico de tábua oca (f0=162 Hz) + toque de ponta (var. 1)) | CC0-1.0 / MIT |
| 10 | `common/step_wood_02.mp3` | common / Locomoção (Madeira) | 0.23 s | 2.04 KB (2089 B) | `-17.9 LUFS` / `-3.60 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Banco modal ortotrópico de tábua oca (f0=176 Hz) + toque de ponta (var. 2)) | CC0-1.0 / MIT |
| 11 | `common/step_wood_03.mp3` | common / Locomoção (Madeira) | 0.23 s | 2.04 KB (2089 B) | `-16.4 LUFS` / `-3.40 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Banco modal ortotrópico de tábua oca (f0=190 Hz) + toque de ponta (var. 3)) | CC0-1.0 / MIT |
| 12 | `common/step_stone_01.mp3` | common / Locomoção (Pedra/Lajota) | 0.21 s | 2.04 KB (2089 B) | `-22.8 LUFS` / `-3.50 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Transiente mineral de alta densidade + modos de laje rígida (f0=204 Hz, var. 1)) | CC0-1.0 / MIT |
| 13 | `common/step_stone_02.mp3` | common / Locomoção (Pedra/Lajota) | 0.21 s | 2.04 KB (2089 B) | `-23.7 LUFS` / `-3.30 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Transiente mineral de alta densidade + modos de laje rígida (f0=223 Hz, var. 2)) | CC0-1.0 / MIT |
| 14 | `common/step_stone_03.mp3` | common / Locomoção (Pedra/Lajota) | 0.21 s | 2.04 KB (2089 B) | `-24.0 LUFS` / `-3.40 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Transiente mineral de alta densidade + modos de laje rígida (f0=242 Hz, var. 3)) | CC0-1.0 / MIT |
| 15 | `common/jump_launch.mp3` | common / Locomoção (Pulo) | 0.34 s | 3.06 KB (3134 B) | `-15.5 LUFS` / `-3.30 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Impulso de solo + whoosh formântico de tecido + nota dupla de marimba de madeira (D4->A4)) | CC0-1.0 / MIT |
| 16 | `common/flutter_ribbon.mp3` | common / Locomoção (Planada Fita) | 0.48 s | 4.08 KB (4179 B) | `-25.1 LUFS` / `-3.50 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Estalo de fita de papel tensionada + batimento aerodinâmico a 13.5 Hz + harmônicos de palheta) | CC0-1.0 / MIT |
| 17 | `common/land_soft.mp3` | common / Locomoção (Pouso Leve) | 0.28 s | 2.45 KB (2507 B) | `-17.3 LUFS` / `-3.50 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Impacto duplo amortecido de sola na terra (96/114 Hz) + acomodação de tecido) | CC0-1.0 / MIT |
| 18 | `common/land_hard.mp3` | common / Locomoção (Pouso Forte) | 0.38 s | 3.26 KB (3343 B) | `-18.0 LUFS` / `-3.20 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Transiente duplo grave (74/88 Hz) + dispersão granular de cascalho e sopro de poeira) | CC0-1.0 / MIT |
| 19 | `common/skid_dust.mp3` | common / Locomoção (Derrapagem) | 0.36 s | 3.06 KB (3134 B) | `-20.9 LUFS` / `-3.40 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Arrasto desacelerado de sola em terra vermelha + micro-grãos de laterita) | CC0-1.0 / MIT |
| 20 | `common/stamp_lock.mp3` | common / Interação (Carimbo Armar) | 0.30 s | 2.65 KB (2716 B) | `-22.0 LUFS` / `-3.50 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Duplo clique mecânico de madeira/latão + tensão stick-slip de papel cartão) | CC0-1.0 / MIT |
| 21 | `common/stamp_impact.mp3` | common / Interação (Carimbo Impacto) | 0.44 s | 3.67 KB (3761 B) | `-18.3 LUFS` / `-3.10 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Impacto grave de borracha/madeira em mesa (68/132 Hz) + sucção de tinta + rebote de mola) | CC0-1.0 / MIT |
| 22 | `common/block_bump.mp3` | common / Interação (Bloco de Marco) | 0.42 s | 3.67 KB (3761 B) | `-17.1 LUFS` / `-3.30 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Batida oca em caixa de papel/madeira + acorde modal de marimba em D Mixolídio (D4-A4-F#5)) | CC0-1.0 / MIT |
| 23 | `common/block_solid.mp3` | common / Interação (Bloco Sólido) | 0.25 s | 2.24 KB (2298 B) | `-20.5 LUFS` / `-3.50 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Impacto inelástico curto em alvenaria/tijolo (modos não-harmônicos 105-690 Hz)) | CC0-1.0 / MIT |
| 24 | `common/signal_collect.mp3` | common / Interação (Sinal Colecionável) | 0.42 s | 3.67 KB (3761 B) | `-14.7 LUFS` / `-3.40 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Gota de tinta + nota dupla sincopada de kalimba/marimba (A5->F#5 com corpo em D5, contorno original)) | CC0-1.0 / MIT |
| 25 | `common/card_open.mp3` | common / UI & Livro Pop-up (Abrir Card) | 0.38 s | 3.26 KB (3343 B) | `-21.8 LUFS` / `-2.60 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Desdobrar de papel cartão pop-up (varredura ascendente 450->7200 Hz) + trava suave) | CC0-1.0 / MIT |
| 26 | `common/card_close.mp3` | common / UI & Livro Pop-up (Fechar Card) | 0.30 s | 2.65 KB (2716 B) | `-18.9 LUFS` / `-3.40 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Dobra descendente de folha de papel + fechamento macio de capa (135/245 Hz)) | CC0-1.0 / MIT |
| 27 | `common/grind_loop.mp3` | common / Locomoção (Grind na Linha) | 2.00 s | 15.92 KB (16300 B) | `-13.7 LUFS` / `-5.40 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Loop seamless 2.0 s de deslizamento em fita de papel + bordão harmônico em D Mixolídio) | CC0-1.0 / MIT |
| 28 | `common/line_pluck_01.mp3` | common / Linha Musical (Marco) | 0.56 s | 4.69 KB (4806 B) | `-17.4 LUFS` / `-3.00 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Dedilhado Karplus-Strong de viola caipira/violão nylon + sopro de sanfona: D4-F#4-A4 (Tônica D Mixolídio)) | CC0-1.0 / MIT |
| 29 | `common/line_pluck_02.mp3` | common / Linha Musical (Marco) | 0.56 s | 4.69 KB (4806 B) | `-19.8 LUFS` / `-3.60 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Dedilhado Karplus-Strong de viola caipira/violão nylon + sopro de sanfona: G4-B4-D5 (Subdominante Baião)) | CC0-1.0 / MIT |
| 30 | `common/line_pluck_03.mp3` | common / Linha Musical (Marco) | 0.56 s | 4.69 KB (4806 B) | `-19.0 LUFS` / `-2.80 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Dedilhado Karplus-Strong de viola caipira/violão nylon + sopro de sanfona: F#4-A4-C5-D5 (Cadência Sétima Mixolídia)) | CC0-1.0 / MIT |
| 31 | `origens/amb_cerrado_dawn.mp3` | origens / Ambiência (Amanhecer no Cerrado) | 12.50 s | 97.96 KB (100310 B) | `-19.8 LUFS` / `-7.80 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Loop seamless 12.5 s: brisa em buritis + coro de cigarras + pássaros do cerrado + respiração de sanfona/zabumba (-20 LUFS)) | CC0-1.0 / MIT |
| 32 | `origens/amb_rio_tocantins.mp3` | origens / Ambiência (Margem Rio Tocantins) | 11.00 s | 86.33 KB (88398 B) | `-21.6 LUFS` / `-8.70 dBTP` | Victor Neves — `game/scripts/build-audio.py` (Loop seamless 11.0 s: correnteza e marolas em pedras de laterita + bolhas hidrodinâmicas + brisa nos juncos (-21 LUFS)) | CC0-1.0 / MIT |

## 4. Reprodução e Auditoria

Para regerar todos os 32 arquivos e revalidar tamanhos e loudness EBU R128:

```powershell
python game/scripts/build-audio.py
node game/scripts/audit-originality.mjs
```
