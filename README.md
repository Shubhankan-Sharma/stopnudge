# StopNudge

StopNudge is a static passenger-stop alert demo made with plain HTML, CSS, and JavaScript. It has no framework, build step, external scripts, analytics, or automatic trip sharing. The route data includes eight Galway demo stops with the distances supplied for this simulation.

The interface is responsive: wide screens use a dashboard layout, while phones use a compact single-column layout, a horizontally scrollable sticky section navigator, larger touch targets, and layouts that avoid horizontal overflow. The CSS and JavaScript are local files served from the same project root.

## Run the app

1. Open a terminal in the `stopnudge` project folder.
2. Run:

   ```bash
   python -m http.server 8000
   ```

3. Open [http://localhost:8000](http://localhost:8000) in your browser.

Use `Ctrl+C` in the terminal to stop the local server.

## Edit the route

Open `stops.js` and edit the `STOPS` array. Each item has this format:

```js
{ name: "Stop name", distanceToNextMetres: 850 }
```

`distanceToNextMetres` is the distance from that stop to the next stop. Every stop except the final stop must have a positive finite distance; set the final stop's distance to `null` because it has no next stop. The current demo route is Corrib Village (900 m), Up Newcastle (400 m), University Central (350 m), Lw Newcastle (600 m), University South (500 m), Galway Cathedral (250 m), St Francis Street (300 m), and Eyre Square (`null`); keep the names and stops in travel order. The destination dropdown is valid only when the destination appears after the starting stop.

## Journey simulation

- The simulation moves by 10 metres per second at `1×`, `50 metres per second` at `5×`, and `200 metres per second` at `20×`.
- The on-screen distance is the distance to the next stop. Total distance remaining includes the rest of the selected route.
- Each stop has independent 500 m and 200 m alert flags. A threshold alert fires when the simulation crosses that threshold; a segment that starts already below a threshold will not replay a threshold it has already passed.
- Each announcement names only the stop associated with that alert, even when adjacent stops are close together. “Welcome aboard” is added only to the first alert of a journey.
- This is a timer-based simulation, not a GPS tracker or live bus-location service.

## Gemma 3 / Ollama announcements

StopNudge requests announcement text from Ollama at `http://localhost:11434/api/generate` using model `gemma3`. Announcement requests start when the journey starts and are processed sequentially, one stop and alert distance at a time, so the timer and alerts do not wait for them. Each request has a 15-second timeout; an unavailable, timed-out, or unsuitable response uses a labelled fallback message, and the visible alert/status includes the fallback reason, such as `Gemma timed out` or `Ollama not reachable`. The status shows `Generating...` while a request is pending. Gemma is asked for one sentence naming only the relevant stop and its distance, with at most 25 words. The browser will only connect to the local Ollama endpoint allowed by the Content Security Policy.

To use Gemma, install and start [Ollama](https://ollama.com/) locally, then download the model if needed:

```bash
ollama pull gemma3
```

If the browser cannot reach Ollama, check that Ollama is running and that its allowed-origin/CORS configuration permits `http://localhost:8000`. StopNudge continues to work with fallback messages when Gemma is offline.

## Alerts, accessibility, and privacy

- On-screen alerts are always displayed in an `aria-live="polite"` region and in the alert history.
- Vibration is used when supported. The keyboard-accessible **Test vibration** button plays the vibration pattern on demand and reports whether vibration is supported. Browser notifications are requested only after the **Enable browser notifications** button is pressed.
- Speech synthesis is enabled by default and can be turned off with the voice toggle. `speakWithElevenLabs()` is a placeholder that returns `"not implemented"`.
- **Share my trip** acts only after the button is pressed. It uses the browser share sheet when available, otherwise it attempts to copy the summary to the clipboard. No trip is saved or shared automatically.
- **Emergency alert prototype:** no contact name or phone number is requested. Press **Prepare emergency alert** to create a message preview with the selected route and next-stop summary, then press **Share emergency alert** to open the device share sheet or copy the message to the clipboard. The user chooses whether and where to send it; StopNudge does not send automatically, contact emergency services, or integrate with an SMS provider or push-notification service.
- **Arrival-safe confirmation:** when the simulated journey reaches the destination, a box automatically previews `StopNudge: [Name] has arrived safely at [destination].` Enter a contact name in the plain-text field to replace `[Name]`; until a name is entered, the placeholder stays visible. The box is labelled **Demo only: no message is sent.** Press **I've arrived safely** to confirm the check-in on screen. This feature makes no network/API requests and does not save the name; it only exists in the current page session and is not a live-GPS or transit-data verification.
- The contact name is not written to local storage, cookies, or a remote backend. No API keys or secrets are included. Separately, the existing Gemma announcement feature sends stop names to the local Ollama endpoint for announcement generation.
- Browser notification, vibration, speech, clipboard, and share support varies by browser and device. On-screen text alerts remain available regardless.

## Deploy to GitHub and Vercel

StopNudge is plain HTML, CSS, and JavaScript, so it does not need a framework, package installation, or build command. The repository should contain `index.html`, `style.css`, `app.js`, `stops.js`, `README.md`, and `.gitignore` at its root.

### Push the project to GitHub

1. Create a new repository on [GitHub](https://github.com/new), for example `stopnudge`. If you are pushing this existing folder, do not initialise the remote repository with an extra README, licence, or `.gitignore`.
2. Open a terminal in this project folder and run the following commands, replacing `YOUR-USERNAME` with your GitHub username:

   ```bash
   git init -b main
   git add index.html style.css app.js stops.js README.md .gitignore
   git commit -m "Initial StopNudge prototype"
   git remote add origin https://github.com/YOUR-USERNAME/stopnudge.git
   git push -u origin main
   ```

   If this folder is already a Git repository, do not repeat `git init`; add and commit your changes, then push to the existing remote.

### Deploy the GitHub repository on Vercel

1. Sign in at [Vercel](https://vercel.com/) and choose **Add New → Project**.
2. Import the `stopnudge` GitHub repository and approve GitHub access if prompted.
3. Configure it as a static site:
   - **Framework Preset:** Other
   - **Root Directory:** `./`
   - **Build Command:** leave blank
   - **Output Directory:** `.` (project root)
4. Select **Deploy**. When deployment finishes, open the `*.vercel.app` URL shown by Vercel.

Once the repository is connected, pushes to the production branch (normally `main`) trigger new production deployments, while other branches can create preview deployments.

### Gemma behaviour on Vercel

The public site cannot directly use the Ollama process running on your laptop. To avoid a deployed page probing a visitor's `localhost`, StopNudge only attempts the Ollama request when the page is opened on `localhost` or `127.0.0.1`; on Vercel, announcements use the existing labelled fallback messages. The journey simulation, stop alerts, vibration test, speech synthesis, emergency preview, and arrival-safe confirmation remain available. To offer Gemma announcements to all visitors later, add a secured server-side endpoint; do not expose an Ollama service publicly or place API secrets in front-end code.



## Mobile display troubleshooting

- Confirm `index.html`, `style.css`, `app.js`, and `stops.js` are all in the deployed repository root. File names are case-sensitive on hosting platforms.
- After pushing CSS changes, trigger or wait for the latest Vercel deployment and hard-refresh the phone browser.
- If the page is visible but unstyled, open `https://YOUR-DEPLOYMENT-URL/style.css` on the phone; it should show CSS text rather than a 404 page.
- Use the sticky Route / Journey / Alerts / Safety navigation to jump between sections on mobile.
