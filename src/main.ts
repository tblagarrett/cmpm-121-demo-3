// @deno-types="npm:@types/leaflet@^1.9.14"
import leaflet, { LatLng } from "leaflet";

// Style sheets
import "leaflet/dist/leaflet.css";
import "./style.css";

// Fix missing marker images
import "./leafletWorkaround.ts";

// Deterministic random number generator
import luck from "./luck.ts";

// Flyweight pattern: Cell Factory to manage cell instances
class CellFactory {
  private static cellCache: Map<string, Cell> = new Map();

  // Convert latitude and longitude to cell grid coordinates
  static getCellFromLatLng(lat: number, lng: number): Cell {
    const i = Math.floor((lat - 0) / TILE_DEGREES);
    const j = Math.floor((lng - 0) / TILE_DEGREES);
    return this.getCell(i, j);
  }

  // Retrieve or create a cell at given i, j coordinates
  static getCell(i: number, j: number): Cell {
    const key = `${i},${j}`;
    if (!this.cellCache.has(key)) {
      this.cellCache.set(key, { i, j });
    }
    return this.cellCache.get(key)!;
  }
}

interface controlButton {
  name: string,
  text: string,
}

interface Cell {
  i: number;
  j: number;
}

interface Memento<T> {
  toMemento(): T;
  fromMemento(memento: T): void;
}

class Cache implements Memento<string> {
  coins: Coin[];
  position: Cell;
  bounds: leaflet.LatLngBounds;

  constructor(position: Cell, bounds: leaflet.LatLngBounds) {
    this.coins = [];
    this.position = position;
    this.bounds = bounds;
  }

  positionToString(): string {
    return `${this.position.i},${this.position.j}`;
  }

  toMemento(): string {
    const mementoData = {
      coins: this.coins.map(coin => ({
        cell: coin.cell,
        serial: coin.serial,
      })),
      position: this.position,
    };
    return JSON.stringify(mementoData);
  }

  fromMemento(memento: string): void {
    const mementoData = JSON.parse(memento);
    this.position = mementoData.position;
    this.coins = mementoData.coins.map((coinData: any) => ({
      cell: coinData.cell,
      serial: coinData.serial,
      toString() {
        return `${this.cell.i}:${this.cell.j}#${this.serial}`;
      },
    }));
  }
}

interface Coin {
  cell: Cell;
  serial: number;
  toString(): string;
}

const app: HTMLDivElement = document.querySelector("#app")!;

const controlButtons: controlButton[] = [
  { name: "sensor", text: "🌐" },
  { name: "north", text: "⬆️" },
  { name: "south", text: "⬇️" },
  { name: "west", text: "⬅️" },
  { name: "east", text: "➡️" },
  { name: "reset", text: "🚮" },
];
addControlButtons(controlButtons);

const statusPanel: HTMLDivElement = document.createElement("div");
statusPanel.id = "statusPanel";
app.appendChild(statusPanel);

const mapElement: HTMLDivElement = document.createElement("div");
mapElement.id = "map";
app.appendChild(mapElement);

// Location of our classroom
const OAKES_CLASSROOM = leaflet.latLng(36.98949379578401, -122.06277128548504);

// Tunable gameplay parameters
const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 1e-4;
const NEIGHBORHOOD_SIZE = 8;
const CACHE_SPAWN_PROBABILITY = 0.1;

// Create the map
const map = leaflet.map(document.getElementById("map")!, {
  center: OAKES_CLASSROOM,
  zoom: GAMEPLAY_ZOOM_LEVEL,
  minZoom: GAMEPLAY_ZOOM_LEVEL,
  maxZoom: GAMEPLAY_ZOOM_LEVEL,
  zoomControl: false,
  scrollWheelZoom: false,
});

// Background tile layer
leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

// Player marker
const playerMarker = leaflet.marker(OAKES_CLASSROOM);
playerMarker.bindTooltip("You");
playerMarker.addTo(map);

// Player's coin inventory
let playerCoins: Coin[] = [];
statusPanel.innerHTML = "No coins yet...";

// Caches
const cacheMementos: Map<string, string> = new Map();
spawnNearbyCaches(OAKES_CLASSROOM);

function movePlayer(direction: Int16Array) {
  let currentPos: leaflet.LatLng = playerMarker.getLatLng();
  let newPos: LatLng = leaflet.latLng(
    currentPos.lat + TILE_DEGREES * direction[0],
    currentPos.lng + TILE_DEGREES * direction[1]
  );
  playerMarker.setLatLng(newPos);

  // Clear and respawn caches based on the new position
  clearCaches();
  spawnNearbyCaches(newPos);
}

function clearCaches() {
  map.eachLayer((layer) => {
    if (layer instanceof leaflet.Rectangle && (layer as any).cache) {
      const cache = (layer as any).cache as Cache;
      cacheMementos.set(cache.positionToString(), cache.toMemento());
      map.removeLayer(layer);
    }
  });
}


function collect(coin: Coin, cache: Cache): void {
  const coinIndex = cache.coins.indexOf(coin);
  if (coinIndex >= 0) {
    // Add coin to player's inventory
    playerCoins.push(coin);
    // Remove coin from cache
    cache.coins.splice(coinIndex, 1);
    cacheMementos.set(cache.positionToString(), cache.toMemento());
    statusPanel.innerHTML = `${playerCoins.length} coins accumulated`;

    // Log collected coin information
    console.log(`Collected coin: ${coin.toString()}`);
  }
}

function deposit(coin: Coin, cache: Cache): void {
  const coinIndex = playerCoins.indexOf(coin);
  if (coinIndex >= 0) {
    // Remove coin from player's inventory
    playerCoins.splice(coinIndex, 1);
    // Add coin back to cache
    cache.coins.push(coin);
    cacheMementos.set(cache.positionToString(), cache.toMemento());
    statusPanel.innerHTML = `${playerCoins.length} coins accumulated`;

    // Log deposited coin information
    console.log(`Deposited coin: ${coin.toString()}`);
  }
}

function addControlButtons(buttons: controlButton[]) {
  const controlPanel: HTMLDivElement = document.createElement("div");
  controlPanel.id = "controlPanel";

  buttons.forEach(button => {
    const btn = document.createElement("button");
    btn.id = button.name;
    btn.title = button.name;
    btn.textContent = button.text;
    
    // Assign movement directions based on button name
    let direction: Int16Array | null = null;
    switch (button.name) {
      case "north":
        direction = new Int16Array([1, 0]);
        break;
      case "south":
        direction = new Int16Array([-1, 0]);
        break;
      case "east":
        direction = new Int16Array([0, 1]);
        break;
      case "west":
        direction = new Int16Array([0, -1]);
        break;
    }

    // Add event listener to move player if a direction is assigned
    if (direction) {
      btn.addEventListener("click", () => movePlayer(direction));
    }

    controlPanel.appendChild(btn);
  });

  app.appendChild(controlPanel);
}


function spawnNearbyCaches(center: leaflet.LatLng) {
  // Convert the center location to grid coordinates
  const centerCell = CellFactory.getCellFromLatLng(center.lat, center.lng);

  for (let i = -NEIGHBORHOOD_SIZE; i < NEIGHBORHOOD_SIZE; i++) {
    for (let j = -NEIGHBORHOOD_SIZE; j < NEIGHBORHOOD_SIZE; j++) {
      const gridI = centerCell.i + i;
      const gridJ = centerCell.j + j;

      if (luck([gridI, gridJ].toString()) < CACHE_SPAWN_PROBABILITY) {
        spawnCache(gridI, gridJ);
      }
    }
  }
}

function spawnCache(i: number, j: number): Cache {
  const cell = CellFactory.getCell(i, j); // Retrieve cell instance
  const positionKey = `${i},${j}`;
  const lat = i * TILE_DEGREES;
  const lng = j * TILE_DEGREES;
  const bounds = leaflet.latLngBounds([
    [lat, lng],
    [lat + TILE_DEGREES, lng + TILE_DEGREES],
  ]);

  const rect = leaflet.rectangle(bounds);
  rect.addTo(map);

  // Create a new Cache object
  const cache = new Cache(cell, bounds);

  // Check if a memento exists for this position
  const memento = cacheMementos.get(positionKey);
  if (memento) {
    // If a memento exists, restore the cache state from the memento
    cache.fromMemento(memento);
  } else {
    // Otherwise, initialize the cache with a default number of coins
    const initialCoins = Math.floor(luck([i, j, "initialValue"].toString()) * 100);
    for (let serial = 0; serial < initialCoins; serial++) {
      const coin: Coin = {
        cell: cell,
        serial: serial,
        toString() {
          return `${this.cell.i}:${this.cell.j}#${this.serial}`;
        },
      };
      cache.coins.push(coin);
    }
  }

  // Store a reference to the cache object directly on the Rectangle layer
  (rect as any).cache = cache;

  rect.bindPopup(() => {
    const popupDiv = document.createElement("div");
    popupDiv.innerHTML = `
      <div>There is a cache here at "${cell.i},${cell.j}". It has <span id="value">${cache.coins.length}</span> coins.</div>
      <button id="take">take</button>
      <button id="give">give</button>`;

    popupDiv.querySelector<HTMLButtonElement>("#take")!.addEventListener("click", () => {
      if (cache.coins.length > 0) {
        const coin = cache.coins[cache.coins.length - 1];
        collect(coin, cache);
        popupDiv.querySelector<HTMLSpanElement>("#value")!.innerHTML = cache.coins.length.toString();
      }
    });

    popupDiv.querySelector<HTMLButtonElement>("#give")!.addEventListener("click", () => {
      if (playerCoins.length > 0) {
        const coin = playerCoins[playerCoins.length - 1];
        deposit(coin, cache);
        popupDiv.querySelector<HTMLSpanElement>("#value")!.innerHTML = cache.coins.length.toString();
      }
    });

    return popupDiv;
  });

  return cache;
}