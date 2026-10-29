/*
 * StopNudge route data
 *
 * distanceToNextMetres is the demo distance FROM this stop TO the next stop.
 * Keep the stops in travel order. The final stop has no next stop, so its
 * distanceToNextMetres must be null.
 */
const STOPS = [
  { name: "Corrib Village", distanceToNextMetres: 900 },
  { name: "Up Newcastle", distanceToNextMetres: 400 },
  { name: "University Central", distanceToNextMetres: 350 },
  { name: "Lw Newcastle", distanceToNextMetres: 600 },
  { name: "University South", distanceToNextMetres: 500 },
  { name: "Galway Cathedral", distanceToNextMetres: 250 },
  { name: "St Francis Street", distanceToNextMetres: 300 },
  { name: "Eyre Square", distanceToNextMetres: null }
];
