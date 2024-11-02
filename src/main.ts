// @deno-types="npm:@types/leaflet@^1.9.14"
import leaflet from "leaflet";

// Style sheets
import "leaflet/dist/leaflet.css";
import "./style.css";

// Fix missing marker images
import "./leafletWorkaround.ts";

// Deterministic random number generator
import luck from "./luck.ts";

interface controlButton {
  name: string,
  text: string,
}

interface Cell {
  i: number;
  j: number;
}

interface Cache {
  coins: number;
  position: Cell;
  bounds: leaflet.LatLngBounds;
}

interface Coin {
  cell: Cell;
  serial: number;
}

const app: HTMLDivElement = document.querySelector("#app")!;

const controlButtons: controlButton[] = [
  {
    name: "sensor",
    text: "🌐",
  },
  {
    name: "north",
    text: "⬆️",
  },
  {
    name: "south",
    text: "⬇️",
  },
  {
    name: "west",
    text: "⬅️",
  },
  {
    name: "east",
    text: "➡️",
  },
  {
    name: "reset",
    text: "🚮",
  },
]
addControlButtons(controlButtons);

const statusPanel: HTMLDivElement = document.createElement("div");
statusPanel.id = "statusPanel"
app.appendChild(statusPanel)

const mapElement: HTMLDivElement = document.createElement("div");
mapElement.id = "map";
app.appendChild(mapElement)

// Location of our classroom (as identified on Google Maps)
const OAKES_CLASSROOM = leaflet.latLng(36.98949379578401, -122.06277128548504);

// Tunable gameplay parameters
const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 1e-4;
const NEIGHBORHOOD_SIZE = 8;
const CACHE_SPAWN_PROBABILITY = 0.1;

// Create the map (element with id "map" is defined in index.html)
const map = leaflet.map(document.getElementById("map")!, {
  center: OAKES_CLASSROOM,
  zoom: GAMEPLAY_ZOOM_LEVEL,
  minZoom: GAMEPLAY_ZOOM_LEVEL,
  maxZoom: GAMEPLAY_ZOOM_LEVEL,
  zoomControl: false,
  scrollWheelZoom: false,
});

// Populate the map with a background tile layer
leaflet
  .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  })
  .addTo(map);

// Add a marker to represent the player
const playerMarker = leaflet.marker(OAKES_CLASSROOM);
playerMarker.bindTooltip("You");
playerMarker.addTo(map);

// Display the player's points
let playerCoins = 0;
statusPanel.innerHTML = "No coins yet...";

spawnNearbyCaches();

// Define a simple unique serial generator for coins
let coinSerialCounter = 0; 
function generateCoinSerial(): number {
  return coinSerialCounter++;
}

function collect(coin: Coin, cache: Cache): void {
  if (cache.coins > 0) {
    playerCoins++;
    cache.coins--;
    statusPanel.innerHTML = `${playerCoins} coins accumulated`;
  }
}

function deposit(coin: Coin, cache: Cache): void {
  playerCoins--;
  cache.coins++;
  statusPanel.innerHTML = `${playerCoins} coins accumulated`;
}

function addControlButtons(buttons) {
  const controlPanel: HTMLDivElement = document.createElement("div");
  controlPanel.id = "controlPanel"

  buttons.forEach(button => {
    const btn = document.createElement("button");
    btn.id = button.name;
    btn.title = button.name;
    btn.textContent = button.text;
    controlPanel.appendChild(btn);
  });

  if (app) {
    app.appendChild(controlPanel);
  }
}

function spawnNearbyCaches() {
  // Look around the player's neighborhood for caches to spawn
  for (let i = -NEIGHBORHOOD_SIZE; i < NEIGHBORHOOD_SIZE; i++) {
    for (let j = -NEIGHBORHOOD_SIZE; j < NEIGHBORHOOD_SIZE; j++) {
      // If location i,j is lucky enough, spawn a cache!
      if (luck([i, j].toString()) < CACHE_SPAWN_PROBABILITY) {
        spawnCache(i, j);
      }
    }
  }
}

function spawnCache(i: number, j: number): Cache {
  const origin = OAKES_CLASSROOM;
  const cell: Cell = { i, j };
  const bounds = leaflet.latLngBounds([
    [origin.lat + i * TILE_DEGREES, origin.lng + j * TILE_DEGREES],
    [origin.lat + (i + 1) * TILE_DEGREES, origin.lng + (j + 1) * TILE_DEGREES],
  ]);

  const rect = leaflet.rectangle(bounds);
  rect.addTo(map);

  let cache: Cache = {
    coins: Math.floor(luck([i, j, "initialValue"].toString()) * 100),
    position: cell,
    bounds: bounds
  };

  rect.bindPopup(() => {
    const popupDiv = document.createElement("div");
    popupDiv.innerHTML = `
      <div>There is a cache here at "${cell.i},${cell.j}". It has <span id="value">${cache.coins}</span> coins.</div>
      <button id="take">take</button>
      <button id="give">give</button>`;

    const coin: Coin = { cell: cell, serial: generateCoinSerial() };

    popupDiv.querySelector<HTMLButtonElement>("#take")!
      .addEventListener("click", () => {
        collect(coin, cache);
        popupDiv.querySelector<HTMLSpanElement>("#value")!.innerHTML = cache.coins.toString();
      });

    popupDiv.querySelector<HTMLButtonElement>("#give")!
      .addEventListener("click", () => {
        if (playerCoins > 0) { // Ensure player has coins to deposit
          deposit(coin, cache);
          popupDiv.querySelector<HTMLSpanElement>("#value")!.innerHTML = cache.coins.toString();
        }
      });

    return popupDiv;
  });

  return cache;
}