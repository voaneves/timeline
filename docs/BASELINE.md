# BASELINE: bruno-simon.com (âncora do 10) — T0.4

Medição local de 2026-11-20 com `game/tools/capture/record.mjs` (Chrome headed, GPU real, ddagrab + h264_amf), 30 s por perfil, entrada simulada por `--script game/tools/capture/scripts/bruno.mjs` (WASD no desktop; joystick por toque via CDP no mobile). Gravações locais e gitignored em `game/tools/capture/baseline/bruno/` (não redistribuir; nenhum asset do Bruno foi copiado para o repositório).

Como rodar de novo:

```
node game/tools/capture/record.mjs --profile desktop --seconds 30 --url https://bruno-simon.com/ --script game/tools/capture/scripts/bruno.mjs --name desktop --out game/tools/capture/baseline/bruno
node game/tools/capture/record.mjs --profile mobile  --seconds 30 --url https://bruno-simon.com/ --script game/tools/capture/scripts/bruno.mjs --name mobile  --out game/tools/capture/baseline/bruno
```

## Desktop (1920x1080, dpr 1, sem throttle de CPU)

| Métrica | Valor |
|---|---|
| Transferência total (CDP, soma de encodedDataLength) | 14,66 MB (15 368 678 B) em 166 requisições |
| Transferido até o start click | ~7,5 MB (o resto, ~7,2 MB, chega em streaming depois do start) |
| Tempo até a 1ª entrada aceita | **≤ 10,8 s** após a navegação (limite superior: "rede ociosa + canvas"; o start click foi feito nesse instante) |
| 1ª tecla efetiva (script) | 15,9 s após a navegação |
| fps médio (30 s) | 62,9 (puxado para baixo por uma parada de 3,3 s no start; fora isso o monitor roda ~75 Hz) |
| Frame time p50 / p95 / p99 / máx | 13,3 / 13,4 / 13,5 / 3320 ms |
| Draw calls por frame | média 230, máx 2237 (hooks em GPURenderPassEncoder/WebGL; o site usa WebGPU; `executeBundles` não expandido) |

Arquivos: `game/tools/capture/baseline/bruno/desktop/{video.mp4,metrics.json,sheet.png}`.

## Mobile (viewport emulada 390x844, dpr 1, CPU throttle 4x, toque)

| Métrica | Valor |
|---|---|
| Transferência total | 14,66 MB (15 367 555 B) em 165 requisições |
| Transferido até a entrada aceita | ~8,7 MB |
| Tempo até a 1ª entrada aceita | 18,7 s após a navegação (o toque de start só foi aceito depois que a intro terminou de carregar; o script repete o toque a cada ~1,5 s, então este valor tem folga de até ~1,5 s) |
| 1º arrasto de joystick | 20,3 s após a navegação |
| fps médio (30 s) | 21,7 |
| Frame time p50 / p95 / p99 / máx | 40,0 / 53,5 / 133,3 / 6227 ms |
| Draw calls por frame | média 210, máx 2489 (mesma ressalva) |

Arquivos: `game/tools/capture/baseline/bruno/mobile/{video.mp4,metrics.json,sheet.png}`.

Ressalvas de método:
- Throttle 4x numa GPU de desktop é um proxy, não um celular real; o número que vale para o gate é o do aparelho do dono.
- As 3 primeiras células da sheet mobile mostram outra janela do Chrome (um preview local de outra tarefa) cobrindo a tela: contaminação visual da captura, não afeta as métricas (vêm do rAF/CDP da página). Uma gravação desktop anterior também foi contaminada e foi movida para `baseline/bruno/_contaminated/`.
- A barra de tradução do Chrome aparece no canto superior direito das gravações (ruído de captura).
- O gate de entrada do site é a classe `input-filter-intro` no `<html>`; no desktop ela não saiu da lista dentro de 3 s, então no desktop o "aceita entrada" é assumido a partir do clique de start (o carro respondeu às teclas nas sheets).
- Não há como ler `renderer.info` (só `__THREE__` é global); por isso os draw calls vêm de hooks nos métodos de draw.

## O que faz parecer 10/10 (visível nas gravações)

- **Loader com identidade:** um anel neon sobre a grade roxa, sem barra de progresso nem texto; já é o mundo (mesma grade e névoa). Depois o mundo "nasce" sobre um disco brilhante, com a árvore e o carro, e o convite "click to start" desenhado à mão, com ícone de som. O start é um clique, sem menu.
- **Câmera:** isométrica alta, segue o carro com atraso suave, dá zoom e afasta no início (da vista do disco para a clareira); profundidade de campo e desfoque nas bordas dão foco no veículo. Nunca enjoa nos 30 s.
- **Movimento:** o carro tem suspensão, inclina em curva, derrapa, bate e empurra objetos (caixas, bancos, letras do nome). Rastros de pneu e partículas (folhas, respingos de água) dão peso. As letras 3D "BRUNO SIMON" são fisicamente empurráveis, o que entrega o primeiro deleite em segundos.
- **Materiais e luz:** baixo-poly estilizado, paleta quente (laranja/coral/rosa) contra o roxo-azul do fundo e da água; folhagem em cartões/pontos com borda brilhante; bloom, vinheta e névoa de cor; ciclo de cor (a paleta muda entre as gravações, de rosa-laranja para azul-noite), o que mostra mundo vivo.
- **UI:** mínima e diegética: toasts curtos ("Server connected", "Nice job!"), cartão de missão ("I'm going on an adventure!"), ícones pequenos de menu e mapa no canto, marcadores no mundo (setas neon, "Change song"). Fonte manuscrita única. No mobile há joystick de toque e botões pequenos, sem poluir a tela.
- **Carga:** ~7,5 MB até poder jogar e o resto em streaming com o jogo já rodando; ainda assim o total (14,7 MB) é pesado, e houve uma parada de 3 a 6 s no start (ponto fraco que o nosso 11 pode superar: controle antes, sem hitch).
- **Ponto fraco no mobile:** ~22 fps com throttle 4x e p99 de 133 ms; há margem para superar.

## Notas do dono (RUBRIC-FORM)

Preencha `docs\RUBRIC-FORM.md` para bruno-simon.com (aparelho, data, nota 0–11 por dimensão, comentário). Essa nota é a âncora do 10 e entra aqui:

- _(vazio, a preencher pelo dono)_
