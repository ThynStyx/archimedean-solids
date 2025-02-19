import { models } from './archimedean-solids-models.js';

let camera = true;
let whichChiralTwin = false;
let selectedRow;
let selectedType = "A";
const searchParams = new URL(document.location).searchParams;
const table = document.getElementById("partsTable");
const tbody = table.createTBody();
const viewer = document.getElementById("viewer");
const showEdges = document.getElementById("showEdges");
const typeId = document.getElementById("typeId");
const zomeSwitch = document.getElementById("zome-switch");
const snubSwitch = document.getElementById("snub-switch");
const postProcessor = document.getElementById("post-processor");

// include a case sensitive "download" query param in the URL to make the ID in the viewer become the .shapes.json download link
if (searchParams.has("download")) {
	document.getElementById("index").addEventListener("click", () => { postProcessor.download = viewer.src });
}

// include a case sensitive "showAnyEdges" query param in the URL to make the checkbox remain visible and functional
const showAnyEdges = searchParams.has("showAnyEdges");
document.getElementById("labelForShowEdges").textContent = "Show " + (showAnyEdges ? "Edges" : "Zometool");

viewer.addEventListener("vzome-scenes-discovered", (e) => {
	// Just logging this to the console for now. Not actually using the scenes list.
	const scenes = e.detail;
	console.log(JSON.stringify(scenes, null, 2));
});

for (const asolid of models) {
	const tr = tbody.insertRow();
	fillRow(tr, asolid);
	tr.addEventListener("click", () => selectArchimedeanSolid(asolid, tr));
}

var initialId = 11;
let aId = parseInt(searchParams.get("A")); // upper case
if (Number.isNaN(aId)) {
	aId = parseInt(searchParams.get("a")); // lower case
}
if (aId >= 1 && aId <= tbody.rows.length) {
	initialId = aId;
}
const initialRow = tbody.rows[initialId - 1];
selectArchimedeanSolid(models[initialId - 1], initialRow);
initialRow.scrollIntoView({ behavior: "smooth", block: "center" });

showEdges.addEventListener("change", // use "change" rather than "click" for a checkbox
	() => {
		setScene(selectedRow.dataset);
	});

// Add the handler to snubSwitch (the parent div) rather than the button itself
// so that the user can click anywhere on the div when the background color changes, not just on the button.
// This isn't necessary on the showEdges checkbox
snubSwitch.addEventListener("click", // use "click" rather than "change" for a button or a div
	() => {
		whichChiralTwin = !whichChiralTwin;
		setScene(selectedRow.dataset);
	});

// After the first design is initially rendered, 
// we don't want to update the camera position with each scene change
viewer.addEventListener("vzome-design-rendered", () => { camera = false; },
	{ once: true }); // automatically remove this listener after it is fired once

// use "click" rather than "change" for each radio button
document.getElementsByName("solid-type").forEach(rb => rb.addEventListener("click",
	e => {
		if (selectedType != e.target.value) {
			selectedType = e.target.value;
			// update the top corner cell in the table header
			typeId.textContent = selectedType;
			const tds = document.querySelectorAll("td.title");
			for (const td of tds) {
				const tr = td.closest("tr");
				const { title, catalan, zometool, zomedual } = tr.dataset;
				const text = selectedType == "C" ? catalan
					: selectedType == "B" ? title + " + dual"
						: title;
				const zome = selectedType == "C" ? zomedual == "true"
					: selectedType == "B" ? zomedual == "true" && zometool == "true"
						: zometool == "true";
				td.textContent = text;
				if (zome) {
					td.classList.add("zometool");
				} else {
					td.classList.remove("zometool");
				}
			}
			setScene(selectedRow.dataset);
		}
	}
));

function selectArchimedeanSolid(asolid, tr) {
	if (tr != selectedRow) {
		const { url, id } = asolid;
		if (url) {
			if (selectedRow) {
				selectedRow.className = "";
			}
			selectedRow = tr;
			selectedRow.className = "selected";
			document.getElementById("index").textContent = selectedType + id;
			switchModel(asolid);
		} else {
			alert("Archimedean or Catalan solid " + selectedType + id + " is not yet available.\n\nPlease help us collect the full set.");
		}
	}
}

function fillRow(tr, asolid) {
	const { id, title, catalan, field, url, edgescene, facescene, zometool, zomedual } = asolid;
	// Data attribute names must be prefixed with 'data-' and should not contain any uppercase letters
	tr.setAttribute("data-id", id);
	tr.setAttribute("data-field", field);
	tr.setAttribute("data-edgescene", edgescene);
	tr.setAttribute("data-facescene", facescene);
	tr.setAttribute("data-title", title);
	tr.setAttribute("data-catalan", catalan);
	tr.setAttribute("data-zometool", zometool);
	tr.setAttribute("data-zomedual", zomedual);
	if (!tr.id) {
		tr.id = "asolid-" + id;
	}
	// Id column
	let td = tr.insertCell();
	td.className = url ? "ident done" : "ident todo";
	td.innerHTML = id;
	// title column
	td = tr.insertCell();
	td.className = "title";
	if (field == "Golden" && zometool == "true" && url) {
		td.className += " zometool";
	}
	if (!!title) {
		td.innerHTML = title;
	}
}

function switchModel(asolid) {
	viewer.src = asolid.url;
	setScene(asolid);
}

function setScene(asolidSceneData) {
	// asolidSceneData may be a asolid object from the JSON
	/// or it may be selectedRow.dataset.
	// Either one should have these properties, all in lower case
	const { id, field, edgescene, facescene, zomedual } = asolidSceneData;
	let { zometool } = asolidSceneData;
	const isSnub = field.toLowerCase().startsWith("snub");
	switch (selectedType) {
		case "B": // Both
			zometool = zometool && zomedual;
			break;
		case "C": // Catalan
			zometool = zomedual;
			break;
	}
	// adjust the scene for golden, snub or neither
	let scene = isSnub
		? (whichChiralTwin ? edgescene : facescene)
		: ((field == "Golden" && zometool == "true") || showAnyEdges) && showEdges.checked ? edgescene : facescene;
	switch (selectedType) {
		case "B": // Both
			scene = "Combined " + scene;
			break;
		case "C": // Catalan
			scene = "Dual " + scene;
			break;
	}
	document.getElementById("index").textContent = selectedType + id;
	// adjust visibility of the checkbox and button 
	zomeSwitch.className = !isSnub && (showAnyEdges || (zometool == "true")) ? 'zome' : 'no-zome';
	snubSwitch.className = isSnub ? 'snub' : 'no-snub';
	viewer.scene = scene;
	viewer.update({ camera });
}
