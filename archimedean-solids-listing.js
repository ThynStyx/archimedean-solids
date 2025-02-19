import { models } from './archimedean-solids-models.js';

let camera = true;
let whichChiralTwin = false;
let selectedRow;
let selectedType = "A";
const searchParams = new URL(document.location).searchParams;
const table = document.getElementById( "partsTable" );
const tbody = table.createTBody();
const viewer = document.getElementById( "viewer" );
const showEdges = document.getElementById( "showEdges" );
const typeId = document.getElementById( "typeId" );
const zomeSwitch = document.getElementById( "zome-switch" );
const snubSwitch = document.getElementById( "snub-switch" );
const downloadLink = document.getElementById( "download" );
const sigfig = 1000000000; // significant digits for rounding

const fixedBackgroundColor = "#AFC8DC";

const shapeColors = new Map();
// TODO: Any changes to these colors should be updated in READM.html as well
shapeColors.set( 3, "#F0A000"); // yellow strut
shapeColors.set( 4, "#007695"); // blue strut
shapeColors.set( 5, "#AF0000"); // red strut
shapeColors.set( 6, "#008D36"); // green strut
shapeColors.set( 8, "#DC4C00"); // orange strut
shapeColors.set(10, "#6C00C6"); // purple strut

// include a case sensitive "download=true" query param in the URL to make the ID in the viewer become the .shapes.json download link
if(searchParams.has("download")) {
	document.getElementById( "index" ).addEventListener( "click", downloadShapesJson );
}

// include a case sensitive "showAnyEdges" query param in the URL to make the checkbox remain visible and functional
const showAnyEdges = searchParams.has("showAnyEdges");
document.getElementById( "labelForShowEdges" ).textContent = "Show " + (showAnyEdges ? "Edges" : "Zometool");

// https://medium.com/charisol-community/downloading-resources-in-html5-a-download-may-not-work-as-expected-bf63546e2baa
// This method works with local files as well as cross origin files.
function downloadShapesJson() {
	const url = viewer.src.replace( ".vZome", ".shapes.json" );
	const filename = url.substring(url.lastIndexOf( "/" ) + 1);
	alert( url );
	
	fetch(url)
	.then(response => {
        if(!response.ok) {
			console.log(response);
			throw new Error(response.url + "\n\n" + response.status + " " + response.statusText) 
        } 
		downloadLink.setAttribute( "download", filename );
		return response.json(); 
	} )
	.then(modelData => {
		const stringifiedData = JSON.stringify(postProcess(modelData), null, 2);
		const blobUrl = URL.createObjectURL(new Blob([stringifiedData], { type: "application/json" }));
		downloadLink.href = blobUrl;
		downloadLink.click();
		URL.revokeObjectURL(blobUrl); // release blobURL resources now that we're done with it.
		downloadLink.href = ""; // remove the reference to the released blobURL.
	})
	.catch(error => {
		console.log(error);
		alert(error);
	});
}

function postProcess(modelData) {
	// desktop has no 'polygons'property for multi-triangle formatted panels
	// desktop saves 'polygons' as a string: "true" for polygon formatted panels
	// online  saves 'polygons' as a boolean: true
	// this should handle any of these cases
	// although some of the subsequent scene processing will fail since online json format is very different, 
	// so bail out here for anything except desktop polygon format 
	// even though some of the code to handle online is here and all of it except standardizeCameras() is working.
	console.log("Model format = " + modelData.format);
	if(modelData.format == "online" || ("" + modelData.polygons) != "true") {
		alert("Model data is not in desktop polygon JSON format. Post processing will be skipped.\n\nJSON format = " + modelData.format);
	} else {
		recolor(modelData);
		rescale(modelData);
		standardizeCameras(modelData);
	}
	return modelData;
}

function standardizeCameras(modelData) {
	// Adjust all camera vector settings to the same values
	// and zoom levels so that any model that's the first one loaded will be zoomed to fit
	// and others will use the same initial zoom level.
	// Any model could be the one that sets the default camera if the "A=" queryparam is used.
	const distance = getDistanceScaledToFitView(modelData);
	standardizeCamera(modelData.camera, distance);
	for(let scene of modelData.scenes) {
		// online json uses scene.camera where desktop json uses scene.view for basically the same object
		standardizeCamera(modelData.format == "online" ? scene.camera : scene.view, distance);
	}
	return modelData;
}

function cameraFieldOfViewY ( width, distance ) {
  const halfX = width / 2;
  const halfY = halfX; // assumes aspectWtoH = 1.0;
  return 360 * Math.atan( halfY / distance ) / Math.PI;
}

function getDistanceScaledToFitView(modelData) {
	const snapshots = getFaceSceneSnapshots(modelData);
	const shapeMap = new Map();
	if(Array.isArray(modelData.shapes)) {
		// modelData.shapes is an array when the json generated in desktop.
		for(const shape of modelData.shapes) {
			shapeMap.set(shape.id, shape);
		}
	} else {
		// modelData.shapes is a collection of properties with guids for names if generated online.
		// TODO: Will this work on an array?
		for (const [id, shape] of Object.entries(modelData.shapes)) {
			if(shape.id == id) { // should always be true, but will this work on an array?
				shapeMap.set(shape.id, shape);
			}
		}
	}
	const origin = {x:0, y:0, z:0};
	var maxRadius = 0;
	for(const snapshot of snapshots) {
		const ss = modelData.snapshots[snapshot];
		for(let i = 0; i < ss.length; i++) {
			const item = ss[i];
			const shapeGuid = typeof item.shapeId === 'undefined' ? item.shape : item.shapeId; // online vs desktop
			const vertices = shapeMap.get(shapeGuid).vertices;
			for(const vertex of vertices) {
				maxRadius = Math.max( maxRadius, edgeLength(origin, vertex) );
			}
		}
	}
	// Originally, I planned to determine the distance based on the view frustum 
	// and a sphere with radius = maxRadius, but I determined that a simple scaling
	// of maxRadius is adequate and much simpler.
	// Emperically, distance ends up being 
	// about 12 for J1 which is the smallest solid
	//   and 48 for J71 which is the biggest solid.
	// For the Archimedean Solids, 
	// A1 (Truncated tetrahedron) is the smallest 
	// and A11 (Trunceted icosadodecahedron) is the largest
	maxRadius *= 8; // Scale factor of 8 was determined empirically as a reasonable best-fit.
	console.log("maxRadius = " + maxRadius);
	return maxRadius;
}

function standardizeCamera(camera, distance) {
	// Much of this is copied from camera.jsx
	const NEAR_FACTOR = 0.1;
	const FAR_FACTOR = 2.0;
	const WIDTH_FACTOR = 0.5;
    camera.viewDistance = distance;
    camera.farClipDistance = distance * FAR_FACTOR;
	camera.nearClipDistance = distance * NEAR_FACTOR;
    camera.width = distance * WIDTH_FACTOR;
    camera.fieldOfView = cameraFieldOfViewY ( camera.width, camera.viewDistance );

	camera.perspective = true;
	camera.stereo = false;

	camera.position.x = 0;
	camera.position.y = 0;
	camera.position.z = camera.viewDistance;

    camera.lookAtPoint.x = 0;
    camera.lookAtPoint.y = 0;
    camera.lookAtPoint.z = 0;

    camera.upDirection.x = 0;
    camera.upDirection.y = 1;
    camera.upDirection.z = 0;
	
    camera.lookDirection.x = 0;
    camera.lookDirection.y = 0;
    camera.lookDirection.z = -1;
    
	// I'm not sure that we need to set all of the RV (RealVector) equivalents, but just in case...
    camera.lookAtPointRV.x = 0.0;
    camera.lookAtPointRV.y = 0.0;
    camera.lookAtPointRV.z = 0.0;
    camera.lookAtPointRV.zero = true;

    camera.upDirectionRV.x = 0.0;
    camera.upDirectionRV.y = 1.0;
    camera.upDirectionRV.z = 0.0;
    camera.upDirectionRV.zero = false;
	
    camera.lookDirectionRV.x = 0.0;
    camera.lookDirectionRV.y = 0.0;
    camera.lookDirectionRV.z = -1.0;
    camera.lookDirectionRV.zero = false;
    
	// don't need to return the camera because it's passed by reference and updated in situ
}

function rescale(modelData) {
	const snapshots = getFaceSceneSnapshots(modelData);
	const shapeMap = new Map();
	if(Array.isArray(modelData.shapes)) {
		// modelData.shapes is an array when the json generated in desktop.
		for(const shape of modelData.shapes) {
			shapeMap.set(shape.id, shape);
		}
	} else {
		// modelData.shapes is a collection of properties with guids for names if generated online.
		// TODO: Will this work on an array?
		for (const [id, shape] of Object.entries(modelData.shapes)) {
			if(shape.id == id) { // should always be true, but will this work on an array?
				shapeMap.set(shape.id, shape);
			}
		}
	}

	var minLength = Number.MAX_VALUE;
	// TODO: deal with the fact that snapshots may be a JavaScript object having keys and values, or it may be an array, depending on the json source
	// Try using for ... in on both an object and an array
	for(const snapshot of snapshots) {
		const ss = modelData.snapshots[snapshot];
		for(let i = 0; i < ss.length; i++) {
			const item = ss[i];
			const shapeGuid = typeof item.shapeId === 'undefined' ? item.shape : item.shapeId; // online vs desktop
			const shape = shapeMap.get(shapeGuid);
			if(isPanel(shape)) {
				const vertices = shape.vertices;
				minLength = Math.min(minLength, edgeLength(vertices[0], vertices[vertices.length-1]));
				for(let v = 1; v < vertices.length; v++) {
					minLength = Math.min( minLength, edgeLength(vertices[v-1], vertices[v]) );
				}			
			}
		}
	}

	const averageLength = minLength;
	// Many models have an averageLength of 8.472135952064994 = (2+4phi) corresponding to blue zometool lengths.
	// The target edge length will be 2 because most of the coordinates on qfbox and wikipedia
	// have edge length of 2, resulting in a half edge length of 1 on each side of the symmetry plane(s).
	const scaleFactor = Math.round((2.0 / averageLength) * sigfig) / sigfig;
	
	console.log("scaleFactor = " + scaleFactor);
	if(!!modelData.scaleFactor) {
		console.log("Previously calculated scaleFactor of " + modelData.scaleFactor + " will not be modified.");
	} else {
		// persist scaleFactor in the json
		modelData.scaleFactor = scaleFactor;
		
		const sigScaleFactor = scaleFactor * sigfig; // scaleVector() will divide by sigfig after rounding
		// scale all shapes
		for(let s = 0; s < modelData.shapes.length; s++) {
			for(let v = 0; v < modelData.shapes[s].vertices.length; v++) {
				scaleVector(sigScaleFactor, modelData.shapes[s].vertices[v]);
			}
		}
		// scale all instances
		for(let i = 0; i < modelData.instances.length; i++) {
			scaleVector(sigScaleFactor, modelData.instances[i].position);
		}
		// scale all snapshots
		for(let i = 0; i < modelData.snapshots.length; i++) {
			for(let j = 0; j < modelData.snapshots[i].length; j++) {
				scaleVector(sigScaleFactor, modelData.snapshots[i][j].position);
			}
		}
	}
	return modelData;
}

function edgeLength(v0, v1) {
	const x = v0.x - v1.x;
	const y = v0.y - v1.y;
	const z = v0.z - v1.z;
	return Math.sqrt((x*x)+(y*y)+(z*z));
}

function scaleVector(scalar, vector) {
	vector.x = Math.round( vector.x * scalar ) / sigfig;
	vector.y = Math.round( vector.y * scalar ) / sigfig;
	vector.z = Math.round( vector.z * scalar ) / sigfig;
	// don't need to return the vector because it's passed by reference and updated in situ
}

function isBall(shape) {
	return !typeof shape.orbit === 'undefined' && shape.name == 'ball';
}

function isStrut(shape) {
	return !typeof shape.orbit === 'undefined';
}

function isPanel(shape) {
	return !isBall(shape) && !isStrut(shape);
	
}

function addPanelToMap(shape, map) {
	if(isPanel(shape)) {
		map.set(shape.id, shape.vertices.length);
	}
}

function recolor(modelData) {
	// Set background color to a hard coded constant
	modelData.lights.backgroundColor = fixedBackgroundColor;
	const snapshots = getFaceSceneSnapshots(modelData);
	const shapeMap = new Map();
	if(Array.isArray(modelData.shapes)) {
		// modelData.shapes is an array when the json generated in desktop.
		for(const shape of modelData.shapes) {
			addPanelToMap(shape, shapeMap);
		}
	} else {
		// modelData.shapes is a collection of properties with guids for names if generated online.
		// TODO: Will this work on an array?
		for (const [id, shape] of Object.entries(modelData.shapes)) {
			if(shape.id == id) { // should always be true, but will this work on an array?
				addPanelToMap(shape, shapeMap);
			}
		}
	}
	for(const snapshot of snapshots) {
		console.log("Preparing to to recolor faces of snapshots[ " + snapshot + " ]");
		const ss = modelData.snapshots[snapshot];
		if(!ss || ss.length == 0) {
			console.log("Snapshot named " + snapshot + " was not found.");
		}
		for(let i = 0; i < ss.length; i++) {
			const item = ss[i];
			const shapeGuid = item.shape;
			const nVertices = shapeMap.get(shapeGuid);
			const newColor = shapeColors.get(nVertices);
			if(newColor) {
				modelData.snapshots[snapshot][i].color = newColor;
			} else {
				console.log("\t\t" + shapeGuid + " skipped - no color found for " + nVertices + " vertices");
			}
		}
	}
	return modelData;
}

function getFaceSceneSnapshots(modelData) {
	// Get a list of facescene(s) of all models that use the selected asolid's URL.
	// There may be only one facescene, but there may be more than one. e.g. J38 & J39
	const url = viewer.src;
	const facescenes = [];
	for(const model of models) {
		if(model.url == url) {
			facescenes.push(model.facescene);
			// Include these two hard coded variants for the Catalans
			facescenes.push("Dual " + model.facescene);
			facescenes.push("Combined " + model.facescene);
			if(model.field.toLowerCase().startsWith("snub")) {
				// For Archimedean snub fields, 
				// The edgescene is supposed to have the chiral twin of facescene instead of struts
				facescenes.push(model.edgescene);
				if(!skip) {
					// Include these two hard coded variants for the Catalans
					facescenes.push("Dual " + model.edgescene);
					facescenes.push("Combined " + model.edgescene);
				}
			}
		}
	}
	const snapshots = [];
	// if(facescenes.includes("default scene")) {
	// 	snapshots.push(0);
	// }
	for(const scene of modelData.scenes) {
		if(facescenes.includes(scene.title)) {
			snapshots.push(scene.snapshot);
		}
	}
	// console.dir(snapshots);
	return snapshots;
}

viewer .addEventListener( "vzome-scenes-discovered", (e) => {
  // Just logging this to the console for now. Not actually using the scenes list.
  const scenes = e.detail;
  //console.log( "These scenes were discovered in " + viewer.src);
  console.log( JSON.stringify( scenes, null, 2 ) );
} );

for (const asolid of models) {
  const tr = tbody.insertRow();
  fillRow(tr, asolid);
  tr.addEventListener("click", () => selectArchimedeanSolid( asolid, tr ) );
}

var initialId = 11;
let aId = parseInt(searchParams.get("A")); // upper case
if(Number.isNaN(aId)) {
	aId = parseInt(searchParams.get("a")); // lower case
}
if(aId >= 1 && aId <= tbody.rows.length) {
	initialId = aId;
}
const initialRow = tbody.rows[ initialId - 1 ];
selectArchimedeanSolid( models[ initialId - 1 ], initialRow );
initialRow.scrollIntoView({ behavior: "smooth", block: "center" });

showEdges.addEventListener("change", // use "change" rather than "click" for a checkbox
  () => {
    setScene(selectedRow.dataset);
  } );

// Add the handler to snubSwitch (the parent div) rather than the button itself
// so that the user can click anywhere on the div when the background color changes, not just on the button.
// This isn't necessary on the showEdges checkbox
snubSwitch.addEventListener("click", // use "click" rather than "change" for a button or a div
  () => {
	whichChiralTwin = !whichChiralTwin;
    setScene(selectedRow.dataset);
  } );

// use "click" rather than "change" for each radio button
document.getElementsByName("solid-type").forEach(rb => rb.addEventListener("click", 
  e => {
	if(selectedType != e.target.value) {
	  selectedType = e.target.value;
	  // update the top corner cell in the table header
	  typeId.textContent = selectedType;
	  const tds = document.querySelectorAll("td.title");
	  for(const td of tds) { 
		const tr = td.closest("tr");
		const { id, title, catalan, zometool, zomedual } = tr.dataset;
		const text = selectedType == "C" ? catalan 
				   : selectedType == "B" ? title + " + dual"
				   						 : title;
		const zome = selectedType == "C" ? zomedual == "true"
				   : selectedType == "B" ? zomedual == "true" && zometool == "true" 
				   						 : zometool == "true";
		td.textContent = text;
		if(zome) {
			td.classList.add("zometool");
		} else {
			td.classList.remove("zometool"); 
		}
	  }
      setScene(selectedRow.dataset);
	}
  }
) );

function selectArchimedeanSolid( asolid, tr ) {
	if(tr != selectedRow) { 
	  const { url, id } = asolid;
		if(url) {
		  if ( selectedRow ) {
			selectedRow.className = "";
		  }
		  selectedRow = tr;
		  selectedRow.className = "selected";
		  document.getElementById( "index" ).textContent = selectedType + id;
		  switchModel(asolid);
	  } else {
		  alert("Archimedean or Catalan solid " + selectedType + id + " is not yet available.\n\nPlease help us collect the full set.");
	  }
	}
}

function fillRow(tr, asolid) {
  const { id, title, field, url, edgescene, facescene, zometool, catalan, zomedual, skip } = asolid;
  // Data attribute names must be prefixed with 'data-' and should not contain any uppercase letters,
  tr.setAttribute("data-id", id);
  tr.setAttribute("data-field", field);
  tr.setAttribute("data-edgescene", edgescene);
  tr.setAttribute("data-facescene", facescene);
  tr.setAttribute("data-title", title);
  tr.setAttribute("data-catalan", catalan);
  tr.setAttribute("data-zometool", zometool);
  tr.setAttribute("data-zomedual", zomedual);
  tr.setAttribute("data-skip", skip);
  if(!tr.id) {
    tr.id = "asolid-" + id;
  }
  // Id column
  let td = tr.insertCell();
  td.className = url ? "ident done" : "ident todo";
  td.innerHTML = id;
  // title column
  td = tr.insertCell();
  td.className = "title";
  if(field == "Golden" && zometool == "true" && url) {
    td.className += " zometool";
  }
  if(!!title) {
    td.innerHTML = title;  
  }
}

function switchModel( asolid ) {
  viewer.src = asolid.url;
  setScene( asolid );
}

// After the first design is initially rendered, 
// we don't want to update the camera position with each scene change
viewer .addEventListener( "vzome-design-rendered", (e) => {
	camera = false;
},
{once: true}); // automatically remove this listener after it is fired once

function setScene( asolidSceneData ) {
  // asolidSceneData may be a asolid object from the JSON
  /// or it may be selectedRow.dataset.
  // Either one should have these properties, all in lower case
  const { id, field, edgescene, facescene, catalan, zomedual, skip } = asolidSceneData;
  const isSnub = field.toLowerCase().startsWith("snub");
  let zometool = asolidSceneData.zometool
  if(skip != "true") { // may be undefined
	switch(selectedType) {
		case "B": // Both
			zometool = zometool && zomedual;
			break;
		case "C": // Catalan
			zometool = zomedual;
			break;
	}
  }
  // adjust the scene for golden, snub or neither
  let scene = isSnub 
  		? (whichChiralTwin ? edgescene : facescene)
		: ((field == "Golden" && zometool == "true") || showAnyEdges) && showEdges.checked ? edgescene : facescene;
  if(skip != "true") { // may be undefined
	switch(selectedType) {
		case "B": // Both
			scene = "Combined " + scene;
			break;
		case "C": // Catalan
			scene = "Dual " + scene;
			break;
	}
  }
  document.getElementById( "index" ).textContent = selectedType + id;
  // adjust visibility of the checkbox and button 
  zomeSwitch.className = !isSnub && (showAnyEdges || (zometool == "true")) ? 'zome' : 'no-zome';
  snubSwitch.className = isSnub ? 'snub' : 'no-snub';
  viewer.scene = scene;
  viewer.update({ camera });
}
