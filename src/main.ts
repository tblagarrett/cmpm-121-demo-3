// @deno-types="npm:@types/leaflet@^1.9.14"
// import leaflet from "leaflet";

// Style sheets
import "leaflet/dist/leaflet.css";
import "./style.css";

// Fix missing marker images
import "./leafletWorkaround.ts";

// Deterministic random number generator
// import luck from "./luck.ts";

const button = document.createElement("button");
button.textContent = "Click Me!";
button.id = "myButton";
button.className = "btn";

button.addEventListener("click", () => {
  alert("Button clicked!");
});

document.body.appendChild(button);
