# Super Victor Timeline

An interactive personal timeline of Victor Neves's life and career, presented as a Super Mario World-style side-scrolling stage. Click a pipe and Mario walks to it to reveal that milestone.

**Demo:** https://voaneves.github.io/timeline/

The page content is in Brazilian Portuguese.

## How it works

- Each milestone is an entry (`year`, `month_name`, `title`) in the `timeline` array in `assets/js/timeline.js`.
- On load, the script creates one pipe (`<li>`) per entry inside the `#events` list. The "Peach" milestone gets its own style.
- Clicking a pipe slides the stage and the ground to that pipe with a CSS transform, plays the walking animation on Mario (left or right, depending on direction) and, when he arrives, activates the pipe to show the milestone.
- Sound effects and the background theme are loaded with the Web Audio API after the first click (`assets/audio/`).
- Other pieces: a light/dark theme toggle (`assets/js/app.js`), a side menu, a custom cursor (`assets/js/cursor.js`), a service worker for caching (`sw.js`, `worker.js`) and a web app manifest (`manifest.json`).

It is a static site: plain HTML, CSS and JavaScript, with no runtime dependencies.

## Running locally

Serve the folder with any static file server (the service worker and audio loading need `http://`, not `file://`). For example:

```sh
python -m http.server 8000
```

Then open http://localhost:8000/.

## Project structure

```
index.html        Page markup, meta tags and inline styles
manifest.json     Web app manifest
sw.js, worker.js  Service worker registration and caching (plus .min.js versions)
assets/
  audio/          Sound effects and theme music
  fonts/          Header font
  img/            Icons, logo and social images
  js/             app, cursor, console and timeline scripts (plus .min.js versions)
  styles/         SCSS sources and compiled timeline.css
```

`index.html` loads the `.min.js` versions of the scripts; the unminified files are the sources.

## License

MIT. See [LICENSE](LICENSE).
