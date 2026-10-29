"use strict";

const OLLAMA_URL = "http://localhost:11434/api/generate";
const ANNOUNCEMENT_TIMEOUT_MS = 15000;
const ALERT_THRESHOLDS = [500, 200];
const ALLOWED_SPEEDS = new Set([1, 5, 20]);

const routeForm = document.getElementById("routeForm");
const startSelect = document.getElementById("startSelect");
const destinationSelect = document.getElementById("destinationSelect");
const speedSelect = document.getElementById("speedSelect");
const startButton = document.getElementById("startButton");
const pauseButton = document.getElementById("pauseButton");
const notificationButton = document.getElementById("notificationButton");
const testVibrationButton = document.getElementById("testVibrationButton");
const voiceButton = document.getElementById("voiceButton");
const shareButton = document.getElementById("shareButton");
const selectionMessage = document.getElementById("selectionMessage");
const journeyStatus = document.getElementById("journeyStatus");
const distanceValue = document.getElementById("distanceValue");
const nextStopLabel = document.getElementById("nextStopLabel");
const remainingValue = document.getElementById("remainingValue");
const gemmaStatus = document.getElementById("gemmaStatus");
const notificationStatus = document.getElementById("notificationStatus");
const vibrationStatus = document.getElementById("vibrationStatus");
const shareStatus = document.getElementById("shareStatus");
const emergencyButton = document.getElementById("emergencyButton");
const shareEmergencyButton = document.getElementById("shareEmergencyButton");
const emergencyStatus = document.getElementById("emergencyStatus");
const emergencyPreviewSection = document.getElementById("emergencyPreviewSection");
const emergencyPreview = document.getElementById("emergencyPreview");
const arrivalConfirmButton = document.getElementById("arrivalConfirmButton");
const arrivalNameInput = document.getElementById("arrivalNameInput");
const arrivalStatus = document.getElementById("arrivalStatus");
const arrivalPreviewSection = document.getElementById("arrivalPreviewSection");
const arrivalPreview = document.getElementById("arrivalPreview");
const liveAlert = document.getElementById("liveAlert");
const alertHistory = document.getElementById("alertHistory");
const routeDataError = document.getElementById("routeDataError");

let selectedStartIndex = null;
let selectedDestinationIndex = null;
let currentStopIndex = null;
let destinationIndex = null;
let distanceRemaining = 0;
let journeyInProgress = false;
let journeyPaused = false;
let voiceEnabled = true;
let timerId = null;
let alertFlags = [];
let announcementCache = new Map();
let firstAlertFired = false;
let emergencyMessage = null;

function isValidStopData() {
  if (!Array.isArray(STOPS) || STOPS.length < 2) {
    return false;
  }

  return STOPS.every((stop, index) => {
    if (!stop || typeof stop.name !== "string" || stop.name.trim() === "") {
      return false;
    }

    // Only the final stop may have no next-stop distance; every earlier
    // segment needs a positive, finite distance for the simulation.
    if (index === STOPS.length - 1) {
      return stop.distanceToNextMetres === null;
    }
    return Number.isFinite(stop.distanceToNextMetres) && stop.distanceToNextMetres > 0;
  });
}

function populateStopDropdown(selectElement, placeholderText) {
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = placeholderText;
  placeholder.disabled = true;
  placeholder.selected = true;
  selectElement.appendChild(placeholder);

  STOPS.forEach((stop, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = stop.name;
    selectElement.appendChild(option);
  });
}

function parseStopIndex(selectElement) {
  const rawValue = selectElement.value;
  if (rawValue === "") {
    return null;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed >= STOPS.length) {
    return null;
  }
  return parsed;
}

function readValidRoute() {
  const startIndex = parseStopIndex(startSelect);
  const endIndex = parseStopIndex(destinationSelect);

  if (startIndex === null || endIndex === null) {
    return { valid: false, startIndex, endIndex, reason: "missing" };
  }
  if (endIndex <= startIndex) {
    return { valid: false, startIndex, endIndex, reason: "order" };
  }
  return { valid: true, startIndex, endIndex, reason: "" };
}

function updateRouteValidation() {
  const route = readValidRoute();
  selectedStartIndex = route.startIndex;
  selectedDestinationIndex = route.endIndex;
  startButton.disabled = !route.valid || !isValidStopData();
  shareButton.disabled = !route.valid;
  emergencyButton.disabled = !route.valid;
  selectionMessage.classList.toggle("is-error", route.reason === "order" || route.reason === "invalid");

  if (!route.valid) {
    selectionMessage.textContent = route.reason === "order"
      ? "Destination must come after the start stop. Choose a later stop."
      : "Choose a starting stop and destination. The destination must come later on the route.";
  } else {
    selectionMessage.textContent = `Route selected: ${STOPS[route.startIndex].name} to ${STOPS[route.endIndex].name}.`;
  }

  if (!journeyInProgress && route.valid) {
    currentStopIndex = route.startIndex;
    destinationIndex = route.endIndex;
    distanceRemaining = STOPS[route.startIndex].distanceToNextMetres;
    renderJourneyMetrics();
    journeyStatus.textContent = "Route ready. Press Start journey to begin.";
  } else if (!journeyInProgress && !route.valid) {
    currentStopIndex = null;
    destinationIndex = null;
    distanceRemaining = 0;
    distanceValue.textContent = "—";
    nextStopLabel.textContent = "Next stop: not selected";
    remainingValue.textContent = "—";
  }
}

function getSpeedMultiplier() {
  const selected = Number(speedSelect.value);
  return ALLOWED_SPEEDS.has(selected) ? selected : 1;
}

function formatMetres(metres) {
  const safeMetres = Number.isFinite(metres) ? Math.max(0, Math.round(metres)) : 0;
  return `${new Intl.NumberFormat("en-IE").format(safeMetres)} m`;
}

function plannedDistance(startIndex, endIndex) {
  if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex) || endIndex <= startIndex) {
    return 0;
  }
  let sum = 0;
  for (let index = startIndex; index < endIndex; index += 1) {
    sum += STOPS[index].distanceToNextMetres;
  }
  return sum;
}

function totalDistanceRemaining() {
  if (currentStopIndex === null || destinationIndex === null || currentStopIndex >= destinationIndex) {
    return 0;
  }

  let total = distanceRemaining;
  for (let index = currentStopIndex + 1; index < destinationIndex; index += 1) {
    total += STOPS[index].distanceToNextMetres;
  }
  return total;
}

function nextStopIndex() {
  if (currentStopIndex === null || destinationIndex === null || currentStopIndex >= destinationIndex) {
    return null;
  }
  return currentStopIndex + 1;
}

function renderJourneyMetrics() {
  const upcomingIndex = nextStopIndex();
  if (upcomingIndex === null) {
    distanceValue.textContent = formatMetres(0);
    nextStopLabel.textContent = destinationIndex !== null
      ? `Arrived at ${STOPS[destinationIndex].name}`
      : "Next stop: not selected";
    remainingValue.textContent = formatMetres(0);
    return;
  }

  distanceValue.textContent = formatMetres(distanceRemaining);
  nextStopLabel.textContent = `Next stop: ${STOPS[upcomingIndex].name}`;
  remainingValue.textContent = formatMetres(totalDistanceRemaining());
}

function announcementKey(stopIndex, threshold) {
  return `${stopIndex}:${threshold}`;
}

function fallbackAnnouncement(stopIndex, threshold, reason = "Gemma still generating") {
  return {
    text: `Next stop: ${STOPS[stopIndex].name} in ${threshold} metres.`,
    source: "fallback",
    reason
  };
}

function canUseLocalOllama() {
  // Never let a publicly hosted StopNudge page probe a visitor's localhost.
  // Local Ollama is only used while StopNudge itself is opened on localhost.
  const hostname = window.location.hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function countWords(text) {
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isUsableGemmaAnnouncement(text, stopIndex, threshold) {
  if (typeof text !== "string") {
    return false;
  }
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned === "" || countWords(cleaned) > 25) {
    return false;
  }

  // Accept only the single-stop, single-distance sentence requested from Gemma.
  const expectedSentence = new RegExp(
    `^Next stop:\\s*${escapeRegExp(STOPS[stopIndex].name)}\\s+in\\s+${threshold}\\s+met(?:re|er)s?\\.?$`,
    "i"
  );
  return expectedSentence.test(cleaned) && !/\bwelcome aboard\b/i.test(cleaned);
}

async function generateGemmaAnnouncement(stopIndex, threshold) {
  if (!canUseLocalOllama()) {
    return fallbackAnnouncement(
      stopIndex,
      threshold,
      "Ollama is available only when StopNudge runs locally"
    );
  }

  const stopName = STOPS[stopIndex].name;
  const prompt = [
    "Write exactly one plain-text sentence for a public transport passenger announcement.",
    `The only stop to name is ${stopName}.`,
    `State that this stop is ${threshold} metres away, using the numeral ${threshold}.`,
    "Use only the stop name and its distance, in a short format like: Next stop: STOP NAME in 500 metres.",
    "Do not name any other stop. Do not say Welcome aboard.",
    "Use at most 25 words. Return only the sentence, with no quotes, labels, bullets, markdown, or explanation."
  ].join("\n");
  const controller = new AbortController();
  const timeoutIdLocal = window.setTimeout(() => controller.abort(), ANNOUNCEMENT_TIMEOUT_MS);
  let fallbackReason = "Ollama not reachable";

  try {
    const response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gemma3", prompt, stream: false }),
      signal: controller.signal
    });

    if (!response.ok) {
      fallbackReason = `Ollama returned HTTP ${response.status}`;
      throw new Error(fallbackReason);
    }

    fallbackReason = "Gemma response was invalid";
    const payload = await response.json();
    const rawText = typeof payload.response === "string" ? payload.response : "";
    const cleaned = rawText.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().replace(/^["'“”]+|["'“”]+$/g, "").trim();
    if (!isUsableGemmaAnnouncement(cleaned, stopIndex, threshold)) {
      throw new Error(fallbackReason);
    }
    return { text: cleaned, source: "gemma" };
  } catch (error) {
    if (error && error.name === "AbortError") {
      fallbackReason = "Gemma timed out";
    } else if (error && typeof error.message === "string" && error.message.startsWith("Ollama returned HTTP ")) {
      fallbackReason = error.message;
    } else if (error instanceof TypeError && fallbackReason === "Ollama not reachable") {
      fallbackReason = "Ollama not reachable";
    }
    return fallbackAnnouncement(stopIndex, threshold, fallbackReason);
  } finally {
    window.clearTimeout(timeoutIdLocal);
  }
}

function prepareAnnouncements(startIndex, endIndex) {
  const thisCache = new Map();
  announcementCache = thisCache;
  let generatedCount = 0;
  let fallbackCount = 0;
  const fallbackReasons = new Map();

  for (let stopIndex = startIndex + 1; stopIndex <= endIndex; stopIndex += 1) {
    for (const threshold of ALERT_THRESHOLDS) {
      const key = announcementKey(stopIndex, threshold);
      thisCache.set(key, fallbackAnnouncement(stopIndex, threshold, "Gemma still generating"));
    }
  }

  gemmaStatus.textContent = "Generating...";
  (async () => {
    for (let stopIndex = startIndex + 1; stopIndex <= endIndex; stopIndex += 1) {
      for (const threshold of ALERT_THRESHOLDS) {
        if (announcementCache !== thisCache) {
          return;
        }
        const key = announcementKey(stopIndex, threshold);
        gemmaStatus.textContent = `Generating... ${STOPS[stopIndex].name} (${threshold} m)`;
        const result = await generateGemmaAnnouncement(stopIndex, threshold);
        if (announcementCache !== thisCache) {
          return;
        }
        thisCache.set(key, result);
        if (result.source === "gemma") {
          generatedCount += 1;
        } else {
          fallbackCount += 1;
          const reason = result.reason || "Unknown reason";
          fallbackReasons.set(reason, (fallbackReasons.get(reason) || 0) + 1);
        }
      }
    }
    const reasonsText = Array.from(fallbackReasons.entries())
      .map(([reason, count]) => `${reason} (${count})`)
      .join(", ");
    gemmaStatus.textContent = `Announcements ready: ${generatedCount} generated by Gemma 3; ${fallbackCount} fallback message(s).${reasonsText ? ` Fallback reasons: ${reasonsText}.` : ""}`;
  })();
}

function speakAnnouncement(text) {
  if (!voiceEnabled || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance !== "function") {
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-IE";
  window.speechSynthesis.speak(utterance);
}

function speakWithElevenLabs() {
  return "not implemented";
}

function vibrateForThreshold(threshold) {
  if (typeof navigator.vibrate !== "function") {
    return;
  }
  if (threshold === 500) {
    navigator.vibrate(200);
  } else if (threshold === 200) {
    navigator.vibrate([200, 100, 200]);
  }
}

function sendBrowserNotification(title, body) {
  if (typeof window.Notification !== "function" || window.Notification.permission !== "granted") {
    return;
  }
  try {
    new window.Notification(title, { body });
  } catch (error) {
    notificationStatus.textContent = "Browser notifications could not be displayed. On-screen alerts remain enabled.";
  }
}

function addAlertToHistory(message) {
  const placeholder = alertHistory.querySelector(".empty-history");
  if (placeholder) {
    placeholder.remove();
  }

  const item = document.createElement("li");
  item.textContent = message;
  alertHistory.appendChild(item);
  liveAlert.textContent = message;
}

function fireAlert(stopIndex, threshold) {
  if (!alertFlags[stopIndex] || alertFlags[stopIndex][threshold]) {
    return;
  }
  alertFlags[stopIndex][threshold] = true;

  const key = announcementKey(stopIndex, threshold);
  const announcement = announcementCache.get(key) || fallbackAnnouncement(stopIndex, threshold);
  const firstAlertGreeting = firstAlertFired ? "" : "Welcome aboard. ";
  firstAlertFired = true;
  const announcedText = `${firstAlertGreeting}${announcement.text}`;
  const sourceLabel = announcement.source === "gemma"
    ? "Generated by Gemma 3"
    : announcement.reason === "Gemma still generating"
      ? `Fallback message — reason: ${announcement.reason}`
      : `Fallback message (Gemma offline) — reason: ${announcement.reason}`;
  const alertText = `${threshold} m alert — ${announcedText} ${sourceLabel}.`;

  addAlertToHistory(alertText);
  vibrateForThreshold(threshold);
  sendBrowserNotification(`StopNudge — ${threshold} m alert`, `${announcedText} ${sourceLabel}.`);
  speakAnnouncement(announcedText);
}

function checkThresholds(previousDistance, currentDistance, targetStopIndex) {
  for (const threshold of ALERT_THRESHOLDS) {
    if (previousDistance > threshold && currentDistance <= threshold) {
      fireAlert(targetStopIndex, threshold);
    }
  }
}

function checkSegmentStartThresholds(targetStopIndex) {
  // If a segment begins exactly at an alert threshold (for example, 500 m),
  // fire that alert once rather than waiting for a crossing that cannot occur.
  for (const threshold of ALERT_THRESHOLDS) {
    if (distanceRemaining === threshold) {
      fireAlert(targetStopIndex, threshold);
    }
  }
}

function clearAlertHistory() {
  alertHistory.textContent = "";
  const item = document.createElement("li");
  item.className = "empty-history";
  item.textContent = "Alerts will appear here as the journey progresses.";
  alertHistory.appendChild(item);
  liveAlert.textContent = "No alerts yet.";
}

function updateJourneyControls() {
  pauseButton.disabled = !journeyInProgress;
  pauseButton.textContent = journeyPaused ? "Resume journey" : "Pause journey";
  startSelect.disabled = journeyInProgress;
  destinationSelect.disabled = journeyInProgress;
  startButton.textContent = journeyInProgress ? "Restart journey" : "Start journey";
}

function completeJourney() {
  journeyInProgress = false;
  journeyPaused = false;
  if (timerId !== null) {
    window.clearInterval(timerId);
    timerId = null;
  }
  currentStopIndex = destinationIndex;
  distanceRemaining = 0;
  journeyStatus.textContent = `Arrived at ${STOPS[destinationIndex].name}. Journey complete.`;
  arrivalConfirmButton.disabled = false;
  arrivalPreview.textContent = buildSafeArrivalPreviewText();
  arrivalPreviewSection.hidden = false;
  arrivalStatus.textContent = `You've reached ${STOPS[destinationIndex].name}. Review the demo message, then press I've arrived safely to confirm.`;
  renderJourneyMetrics();
  updateJourneyControls();
}

function tickJourney() {
  if (!journeyInProgress || journeyPaused) {
    return;
  }

  const targetIndex = nextStopIndex();
  if (targetIndex === null) {
    completeJourney();
    return;
  }

  const previousDistance = distanceRemaining;
  const metresPerTick = 10 * getSpeedMultiplier();
  distanceRemaining = Math.max(0, distanceRemaining - metresPerTick);
  renderJourneyMetrics();
  checkThresholds(previousDistance, distanceRemaining, targetIndex);

  if (distanceRemaining <= 0) {
    currentStopIndex = targetIndex;
    if (currentStopIndex >= destinationIndex) {
      completeJourney();
      return;
    }
    distanceRemaining = STOPS[currentStopIndex].distanceToNextMetres;
    journeyStatus.textContent = `Passed ${STOPS[currentStopIndex].name}. Continuing to ${STOPS[currentStopIndex + 1].name}.`;
    checkSegmentStartThresholds(currentStopIndex + 1);
    renderJourneyMetrics();
  }
}

function startJourney() {
  const route = readValidRoute();
  if (!route.valid || !isValidStopData()) {
    updateRouteValidation();
    return;
  }

  if (timerId !== null) {
    window.clearInterval(timerId);
  }
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }

  resetSafetyFlows();
  selectedStartIndex = route.startIndex;
  selectedDestinationIndex = route.endIndex;
  currentStopIndex = route.startIndex;
  destinationIndex = route.endIndex;
  distanceRemaining = STOPS[currentStopIndex].distanceToNextMetres;
  journeyInProgress = true;
  journeyPaused = false;
  alertFlags = STOPS.map(() => ({ 500: false, 200: false }));
  firstAlertFired = false;
  shareStatus.textContent = "";
  clearAlertHistory();
  prepareAnnouncements(route.startIndex, route.endIndex);
  journeyStatus.textContent = `Journey started: ${STOPS[route.startIndex].name} to ${STOPS[route.endIndex].name}.`;
  arrivalStatus.textContent = "Your safe-arrival confirmation will become available when you reach the destination.";
  updateJourneyControls();
  checkSegmentStartThresholds(currentStopIndex + 1);
  renderJourneyMetrics();

  timerId = window.setInterval(tickJourney, 1000);
}

function togglePause() {
  if (!journeyInProgress) {
    return;
  }
  journeyPaused = !journeyPaused;
  if (journeyPaused) {
    journeyStatus.textContent = "Journey paused.";
  } else {
    journeyStatus.textContent = `Journey resumed. Heading to ${STOPS[currentStopIndex + 1].name}.`;
  }
  updateJourneyControls();
}

async function enableNotificationsFromClick() {
  if (typeof window.Notification !== "function") {
    notificationStatus.textContent = "This browser does not support notifications. On-screen alerts remain enabled.";
    return;
  }

  if (window.Notification.permission === "granted") {
    notificationStatus.textContent = "Browser notifications are enabled.";
    return;
  }
  if (window.Notification.permission === "denied") {
    notificationStatus.textContent = "Notifications are blocked in browser settings. On-screen alerts remain enabled.";
    return;
  }

  try {
    const permission = await window.Notification.requestPermission();
    notificationStatus.textContent = permission === "granted"
      ? "Browser notifications are enabled."
      : "Notification permission was not granted. On-screen alerts remain enabled.";
  } catch (error) {
    notificationStatus.textContent = "Could not request notification permission. On-screen alerts remain enabled.";
  }
}

function toggleVoice() {
  voiceEnabled = !voiceEnabled;
  voiceButton.setAttribute("aria-pressed", String(voiceEnabled));
  voiceButton.textContent = `Voice announcements: ${voiceEnabled ? "On" : "Off"}`;
  if (!voiceEnabled && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

function testVibrationFromClick() {
  if (typeof navigator.vibrate !== "function") {
    vibrationStatus.textContent = "Vibration not supported on this device";
    return;
  }

  try {
    const sent = navigator.vibrate([200, 100, 200]);
    vibrationStatus.textContent = sent === false
      ? "Vibration not supported on this device"
      : "Vibration sent";
  } catch (error) {
    vibrationStatus.textContent = "Vibration not supported on this device";
  }
}

function buildTripSummary() {
  const route = readValidRoute();
  if (!route.valid) {
    return null;
  }

  let startName = STOPS[route.startIndex].name;
  let destinationName = STOPS[route.endIndex].name;
  let nextName = "Not started";
  let remainingMetres = plannedDistance(route.startIndex, route.endIndex);

  if (destinationIndex === route.endIndex && currentStopIndex !== null && journeyInProgress) {
    startName = STOPS[route.startIndex].name;
    nextName = nextStopIndex() === null ? "Arrived" : STOPS[nextStopIndex()].name;
    remainingMetres = totalDistanceRemaining();
  } else if (destinationIndex === route.endIndex && currentStopIndex !== null && currentStopIndex >= route.endIndex) {
    nextName = "Arrived";
    remainingMetres = 0;
  } else {
    nextName = STOPS[route.startIndex + 1].name;
  }

  return [
    "StopNudge trip summary",
    `Start: ${startName}`,
    `Destination: ${destinationName}`,
    `Next stop: ${nextName}`,
    `Distance remaining: ${formatMetres(remainingMetres)}`
  ].join("\n");
}

async function shareTripFromClick() {
  const summary = buildTripSummary();
  if (!summary) {
    shareStatus.textContent = "Choose a valid route before sharing the trip summary.";
    return;
  }

  shareStatus.textContent = "";
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "My StopNudge trip", text: summary });
      shareStatus.textContent = "Trip summary shared.";
      return;
    } catch (error) {
      if (error && error.name === "AbortError") {
        shareStatus.textContent = "Sharing cancelled. Nothing was sent.";
        return;
      }
      shareStatus.textContent = "Sharing was unavailable. Trying to copy the summary instead.";
    }
  }

  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(summary);
      shareStatus.textContent = "Trip summary copied to the clipboard. Nothing was shared automatically.";
      return;
    } catch (error) {
      shareStatus.textContent = `Could not copy automatically. You can copy this summary manually:\n${summary}`;
      return;
    }
  }

  shareStatus.textContent = `Sharing and clipboard access are unavailable. Copy this summary manually:\n${summary}`;
}

function resetSafetyFlows() {
  emergencyMessage = null;
  shareEmergencyButton.disabled = true;
  arrivalConfirmButton.disabled = true;
  emergencyPreview.textContent = "";
  emergencyPreviewSection.hidden = true;
  arrivalPreview.textContent = "";
  arrivalPreviewSection.hidden = true;
  emergencyStatus.textContent = "Prepare an emergency alert to preview a message. No contact details are needed in this prototype.";
  arrivalStatus.textContent = "Complete the journey to preview and confirm your safe arrival.";
  arrivalConfirmButton.textContent = "I've arrived safely";
}

function prepareEmergencyAlert() {
  const tripSummary = buildTripSummary();
  if (!tripSummary) {
    emergencyStatus.textContent = "Choose a valid route before preparing an emergency alert.";
    return;
  }

  const tripLines = tripSummary.split("\n").slice(1);
  emergencyMessage = [
    "STOPNUDGE EMERGENCY ALERT",
    "I need help. Please contact me as soon as possible.",
    "",
    ...tripLines,
    "",
    "Prototype notice: this is simulated journey data. No live GPS location or automatic emergency dispatch is available."
  ].join("\n");

  emergencyPreview.textContent = emergencyMessage;
  emergencyPreviewSection.hidden = false;
  shareEmergencyButton.disabled = false;
  emergencyStatus.textContent = "Emergency alert preview ready. Nothing has been sent; choose Share emergency alert to share it yourself.";
}

function buildSafeArrivalPreviewText() {
  if (destinationIndex === null) {
    return "";
  }

  // Keep the name transient and plain text. textContent renders it as text,
  // and this feature does not persist it or send it to any service.
  const enteredName = arrivalNameInput.value
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, 80);
  const displayName = enteredName || "[Name]";
  return `StopNudge: ${displayName} has arrived safely at ${STOPS[destinationIndex].name}.`;
}

function updateSafeArrivalPreviewIfAvailable() {
  if (journeyInProgress || destinationIndex === null || currentStopIndex !== destinationIndex || arrivalPreviewSection.hidden) {
    return;
  }
  arrivalPreview.textContent = buildSafeArrivalPreviewText();
}

function confirmSafeArrival() {
  if (journeyInProgress || destinationIndex === null || currentStopIndex !== destinationIndex) {
    arrivalStatus.textContent = "Finish the simulated journey before confirming your arrival.";
    return;
  }

  arrivalPreview.textContent = buildSafeArrivalPreviewText();
  arrivalPreviewSection.hidden = false;
  arrivalConfirmButton.disabled = true;
  arrivalConfirmButton.textContent = "Arrival confirmed";
  arrivalStatus.textContent = `Arrival confirmed at ${STOPS[destinationIndex].name}. Demo only: no message has been sent.`;
}

async function sharePreparedMessage(message, title, statusElement, label) {
  if (typeof message !== "string" || message.length === 0) {
    statusElement.textContent = "Prepare the message first.";
    return;
  }

  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text: message });
      statusElement.textContent = `${label} shared using your device's share menu.`;
      return;
    } catch (error) {
      if (error && error.name === "AbortError") {
        statusElement.textContent = `Sharing cancelled. Nothing was sent by StopNudge.`;
        return;
      }
    }
  }

  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(message);
      statusElement.textContent = `${label} copied to the clipboard. Choose a messaging app or contact to send it; StopNudge has not sent anything.`;
      return;
    } catch (error) {
      statusElement.textContent = `Sharing and clipboard access are unavailable. Copy the message from the preview below; StopNudge has not sent anything.`;
      return;
    }
  }

  statusElement.textContent = `Sharing and clipboard access are unavailable. Copy the message from the preview below; StopNudge has not sent anything.`;
}

function init() {
  if (!isValidStopData()) {
    routeDataError.hidden = false;
    startButton.disabled = true;
    shareButton.disabled = true;
    emergencyButton.disabled = true;
    startSelect.disabled = true;
    destinationSelect.disabled = true;
    selectionMessage.textContent = "Route configuration is invalid. Check stops.js.";
    journeyStatus.textContent = "Cannot start: route data is invalid.";
    return;
  }

  populateStopDropdown(startSelect, "Choose a starting stop");
  populateStopDropdown(destinationSelect, "Choose a destination");
  updateRouteValidation();

  routeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    startJourney();
  });
  startSelect.addEventListener("change", () => {
    updateRouteValidation();
    resetSafetyFlows();
  });
  destinationSelect.addEventListener("change", () => {
    updateRouteValidation();
    resetSafetyFlows();
  });
  speedSelect.addEventListener("change", () => {
    if (!ALLOWED_SPEEDS.has(Number(speedSelect.value))) {
      speedSelect.value = "1";
    }
  });
  pauseButton.addEventListener("click", togglePause);
  notificationButton.addEventListener("click", enableNotificationsFromClick);
  testVibrationButton.addEventListener("click", testVibrationFromClick);
  voiceButton.addEventListener("click", toggleVoice);
  shareButton.addEventListener("click", shareTripFromClick);
  emergencyButton.addEventListener("click", prepareEmergencyAlert);
  shareEmergencyButton.addEventListener("click", () => {
    sharePreparedMessage(emergencyMessage, "StopNudge emergency alert", emergencyStatus, "Emergency alert");
  });
  arrivalConfirmButton.addEventListener("click", confirmSafeArrival);
  arrivalNameInput.addEventListener("input", updateSafeArrivalPreviewIfAvailable);
}

init();
