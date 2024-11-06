// @deno-types="npm:@types/leaflet@^1.9.14"
import leaflet, { LatLng } from "leaflet";

// Style sheets
import "leaflet/dist/leaflet.css";
import "./style.css";

// Fix missing marker images
import "./leafletWorkaround.ts";

// Deterministic random number generator
import luck from "./luck.ts";

class Player {
  private position: LatLng;
  private marker: leaflet.Marker;

  constructor(initialPosition: LatLng, map: leaflet.Map) {
    this.position = initialPosition;
    this.marker = leaflet.marker(this.position).addTo(map);
    this.marker.bindTooltip("You");
  }

  move(newPosition: LatLng) {
    this.position = newPosition;
    this.marker.setLatLng(this.position);
  }

  getPosition(): LatLng {
    return this.position;
  }
}

class MovementHistory {
  private polyline: leaflet.Polyline;
  private positions: LatLng[];

  constructor(map: leaflet.Map, startPosition: LatLng) {
    this.positions = [startPosition];
    this.polyline = leaflet.polyline(this.positions, {
      color: "orange",
      weight: 3,
    }).addTo(map);
  }

  addPosition(position: LatLng): void {
    this.positions.push(position);
    this.polyline.setLatLngs(this.positions);
  }

  clear(startPosition: LatLng): void {
    this.positions = [startPosition];
    this.polyline.setLatLngs(this.positions);
    this.polyline.redraw();
  }
}

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
      coins: this.coins.map((coin) => ({
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
    this.coins = mementoData.coins.map((coinData: CoinData) => ({
      cell: coinData.cell,
      serial: coinData.serial,
      toString() {
        return `${this.cell.i}:${this.cell.j}#${this.serial}`;
      },
    }));
  }
}

interface controlButton {
  name: string;
  text: string;
}

interface Cell {
  i: number;
  j: number;
}

interface Memento<T> {
  toMemento(): T;
  fromMemento(memento: T): void;
}

interface Coin {
  cell: Cell;
  serial: number;
  toString(): string;
}

interface CoinData {
  cell: Cell;
  serial: number;
}

type CacheLayer = leaflet.Rectangle & { cache: Cache };

const app: HTMLDivElement = document.querySelector("#app")!;

const controlPanel: HTMLDivElement = document.createElement("div");
controlPanel.id = "controlPanel";
app.appendChild(controlPanel);

const statusPanel: HTMLDivElement = document.createElement("div");
statusPanel.id = "statusPanel";
app.appendChild(statusPanel);

const coinDropdown = document.createElement("select");
coinDropdown.id = "coinDropdown";
coinDropdown.innerHTML = "<option>No coins yet...</option>";
statusPanel.appendChild(coinDropdown);

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
const player = new Player(OAKES_CLASSROOM, map);
const movementHistory = new MovementHistory(map, player.getPosition());

const controlButtons: controlButton[] = [
  { name: "sensor", text: "🌐" },
  { name: "north", text: "⬆️" },
  { name: "south", text: "⬇️" },
  { name: "west", text: "⬅️" },
  { name: "east", text: "➡️" },
  { name: "reset", text: "🚮" },
];
addControlButtons(controlButtons);
document.getElementById("sensor")!.addEventListener(
  "click",
  toggleGeolocationTracking,
);

// Background tile layer
leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

// Player's coin inventory
let playerCoins: Coin[] = [];

// Caches
const existingRectangles: Map<string, leaflet.Rectangle> = new Map();
const cacheMementos: Map<string, string> = new Map();
spawnNearbyCaches(OAKES_CLASSROOM);

let geolocationWatchId: number | null = null;

function toggleGeolocationTracking() {
  if (geolocationWatchId === null) {
    // Start geolocation tracking
    geolocationWatchId = navigator.geolocation.watchPosition((position) => {
      const newLocation = leaflet.latLng(
        position.coords.latitude,
        position.coords.longitude,
      );
      movePlayer(newLocation);
      map.setView(player.getPosition(), GAMEPLAY_ZOOM_LEVEL);
    });
    movementHistory.clear(player.getPosition());
  } else {
    // Stop geolocation tracking
    navigator.geolocation.clearWatch(geolocationWatchId);
    geolocationWatchId = null;
  }
}

function movePlayer(newPosition: LatLng) {
  player.move(newPosition);
  movementHistory.addPosition(newPosition);

  clearCaches();
  spawnNearbyCaches(newPosition);
}

function calculateNewPosition(
  currentPosition: LatLng,
  direction: Int16Array,
): LatLng {
  return leaflet.latLng(
    currentPosition.lat + TILE_DEGREES * direction[0],
    currentPosition.lng + TILE_DEGREES * direction[1],
  );
}

function clearCaches() {
  map.eachLayer((layer) => {
    if (layer instanceof leaflet.Rectangle && (layer as CacheLayer).cache) {
      const cache = (layer as CacheLayer).cache as Cache;
      cacheMementos.set(cache.positionToString(), cache.toMemento());
      map.removeLayer(layer);
    }
  });

  existingRectangles.clear();
}

function collect(coin: Coin, cache: Cache): void {
  const coinIndex = cache.coins.indexOf(coin);
  if (coinIndex >= 0) {
    // Add coin to player's inventory
    playerCoins.push(coin);
    updateCoinDropdown();

    // Remove coin from cache
    cache.coins.splice(coinIndex, 1);
    cacheMementos.set(cache.positionToString(), cache.toMemento());

    // Log collected coin information
    console.log(`Collected coin: ${coin.toString()}`);
  }
}

function deposit(coin: Coin, cache: Cache): void {
  const coinIndex = playerCoins.indexOf(coin);
  if (coinIndex >= 0) {
    // Remove coin from player's inventory
    playerCoins.splice(coinIndex, 1);
    updateCoinDropdown();

    // Add coin back to cache
    cache.coins.push(coin);
    cacheMementos.set(cache.positionToString(), cache.toMemento());

    // Log deposited coin information
    console.log(`Deposited coin: ${coin.toString()}`);
  }
}

function updateCoinDropdown(): void {
  // Clear the existing options
  coinDropdown.innerHTML = "";

  if (playerCoins.length > 0) {
    // Set the first option to display the coin count
    const coinCountOption = document.createElement("option");
    coinCountOption.text = `${playerCoins.length} coins accumulated`;
    coinDropdown.add(coinCountOption);

    // Add each coin to the dropdown as selectable options
    playerCoins.forEach((coin, index) => {
      const option = document.createElement("option");
      option.text = coin.toString();
      option.value = index.toString(); // Store index as value to easily access coin later
      coinDropdown.add(option);
    });

    // Add an event listener to detect changes in the dropdown selection
    coinDropdown.addEventListener("change", () => {
      const selectedIndex = coinDropdown.selectedIndex - 1; // Adjust index (skip first option)
      if (selectedIndex >= 0) {
        const selectedCoin = playerCoins[selectedIndex];
        const coinCachePosition = selectedCoin.cell;
        const lat = coinCachePosition.i * TILE_DEGREES;
        const lng = coinCachePosition.j * TILE_DEGREES;

        // Center the map on the coin's home cache location
        map.setView([lat, lng], GAMEPLAY_ZOOM_LEVEL);
      }
    });
  } else {
    // Show "No coins yet..." if there are no coins
    const noCoinsOption = document.createElement("option");
    noCoinsOption.text = "No coins yet...";
    coinDropdown.add(noCoinsOption);
  }
}

function addControlButtons(buttons: controlButton[]) {
  buttons.forEach((button) => {
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
      case "reset":
        btn.addEventListener("click", () => {
          // Prompt the user for confirmation
          const confirmation = prompt(
            "Are you sure you want to erase your game state? (yes/no)",
          );
          if (
            confirmation &&
            (confirmation.toLowerCase() === "yes" ||
              confirmation.toLowerCase() === "y")
          ) {
            // Clear mementos
            cacheMementos.clear();

            // Clear all cache layers
            map.eachLayer((layer) => {
              if (
                layer instanceof leaflet.Rectangle &&
                (layer as CacheLayer).cache
              ) {
                map.removeLayer(layer);
              }
            });

            // Clear movement history and player coins
            movementHistory.clear(player.getPosition());
            playerCoins = [];
            updateCoinDropdown();

            // Regenerate caches around the player's current position
            spawnNearbyCaches(player.getPosition());
          }
        });
        break;
    }

    // Add event listener to move player if a direction is assigned
    if (direction) {
      btn.addEventListener(
        "click",
        () => movePlayer(calculateNewPosition(player.getPosition(), direction)),
      );
    }

    controlPanel.appendChild(btn);
  });
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

  // Check if a rectangle already exists for this position
  if (existingRectangles.has(positionKey)) {
    const cache = new Cache(cell, bounds);
    const memento = cacheMementos.get(positionKey);
    if (memento) {
      cache.fromMemento(memento);
      return cache;
    }
  }

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
    const initialCoins = Math.floor(
      luck([i, j, "initialValue"].toString()) * 100,
    );
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
  (rect as CacheLayer).cache = cache;

  // Bind popup and actions
  rect.bindPopup(() => {
    const popupDiv = document.createElement("div");
    popupDiv.innerHTML = `
      <div>There is a cache here at "${cell.i},${cell.j}". It has <span id="value">${cache.coins.length}</span> coins.</div>
      <button id="take">take</button>
      <button id="give">give</button>`;

    popupDiv.querySelector<HTMLButtonElement>("#take")!.addEventListener(
      "click",
      () => {
        if (cache.coins.length > 0) {
          const coin = cache.coins[cache.coins.length - 1];
          collect(coin, cache);
          popupDiv.querySelector<HTMLSpanElement>("#value")!.innerHTML = cache
            .coins.length.toString();
        }
      },
    );

    popupDiv.querySelector<HTMLButtonElement>("#give")!.addEventListener(
      "click",
      () => {
        if (playerCoins.length > 0) {
          const coin = playerCoins[playerCoins.length - 1];
          deposit(coin, cache);
          popupDiv.querySelector<HTMLSpanElement>("#value")!.innerHTML = cache
            .coins.length.toString();
        }
      },
    );

    return popupDiv;
  });

  // Store the rectangle in the map to avoid duplicates
  existingRectangles.set(positionKey, rect);

  return cache;
}
