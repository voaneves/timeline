import * as THREE from 'three/webgpu'

const text = `
██╗   ██╗██╗ ██████╗████████╗ ██████╗ ██████╗     ███╗   ██╗███████╗██╗   ██╗███████╗███████╗
██║   ██║██║██╔════╝╚══██╔══╝██╔═══██╗██╔══██╗    ████╗  ██║██╔════╝██║   ██║██╔════╝██╔════╝
██║   ██║██║██║        ██║   ██║   ██║██████╔╝    ██╔██╗ ██║█████╗  ██║   ██║█████╗  ███████╗
╚██╗ ██╔╝██║██║        ██║   ██║   ██║██╔══██╗    ██║╚██╗██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ╚════██║
 ╚████╔╝ ██║╚██████╗   ██║   ╚██████╔╝██║  ██║    ██║ ╚████║███████╗ ╚████╔╝ ███████╗███████║
  ╚═══╝  ╚═╝ ╚═════╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝    ╚═╝  ╚═══╝╚══════╝  ╚═══╝  ╚══════╝╚══════╝

╔═ Intro ═══════════════╗
║ Thank you for visiting Victor Neves's interactive 3D timeline and portfolio!
║ Explore the island to discover milestones, open-source projects, and mini-games.
╚═══════════════════════╝

╔═ Links ═══════════════╗
║ Website     ⇒ https://voaneves.com/#contato
║ Timeline 2D ⇒ https://voaneves.github.io/timeline/
║ GitHub      ⇒ https://github.com/voaneves
║ LinkedIn    ⇒ https://linkedin.com/in/voaneves
║ YouTube     ⇒ https://youtube.com/c/voaneves
╚═══════════════════════╝

╔═ Debug ═══════════════╗
║ You can access the debug mode by adding #debug at the end of the URL and reloading.
║ Press [V] to toggle the free camera.
╚═══════════════════════╝

╔═ Tech Stack ══════════╗
║ Three.js (WebGPU / TSL, release: ${THREE.REVISION}) ⇒ https://threejs.org/
║ Rapier (Physics)          ⇒ https://rapier.rs/
║ Howler.js (Audio)         ⇒ https://howlerjs.com/
║ Source repository         ⇒ https://github.com/voaneves/timeline
╚═══════════════════════╝
`
let finalText = ''
let finalStyles = []
const stylesSet = {
    letter: 'color: #ffffff; font: 400 1em monospace;',
    pipe: 'color: #2AD4D9; font: 400 1em monospace;',
}
let currentStyle = null
for(let i = 0; i < text.length; i++)
{
    const char = text[i]

    const style = char.match(/[╔║═╗╚╝╔╝]/) ? 'pipe' : 'letter'
    if(style !== currentStyle)
    {
        currentStyle = style
        finalText += '%c'

        finalStyles.push(stylesSet[currentStyle])
    }
    finalText += char
}

export default [finalText, ...finalStyles]
