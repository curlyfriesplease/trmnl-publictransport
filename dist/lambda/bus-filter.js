"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const axios_1 = __importDefault(require("axios"));
const xml2js_1 = require("xml2js");
const dotenv = __importStar(require("dotenv"));
const fs = __importStar(require("fs/promises")); // Import fs promises
const path = __importStar(require("path")); // Import path
// Load environment variables from .env file
dotenv.config();
// --- Helper Functions ---
/**
 * Calculates the distance between two lat/lon coordinates in kilometers using the Haversine formula.
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the Earth in kilometers
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) *
            Math.cos(lat2 * (Math.PI / 180)) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    return distance;
}
/**
 * Loads route point data from JSON files for the specified line references.
 */
async function loadRouteData(lineRefs) {
    const routeData = {};
    const routeFilesDir = path.join(__dirname, 'busroutes'); // Assumes busroutes is in the same dir as the compiled JS
    console.log(`Attempting to load route data for lines: ${lineRefs.join(', ')}`);
    console.log(`Looking in directory: ${routeFilesDir}`);
    for (const lineRef of lineRefs) {
        const filePath = path.join(routeFilesDir, `${lineRef}.json`);
        try {
            const fileContent = await fs.readFile(filePath, 'utf-8');
            routeData[lineRef] = JSON.parse(fileContent);
            console.log(`Successfully loaded route data for LineRef: ${lineRef}`);
        }
        catch (error) {
            // Log error but continue; allows function to work even if some routes are missing
            if (error.code === 'ENOENT') {
                console.warn(`Warning: Route data file not found for LineRef: ${lineRef} at ${filePath}`);
            }
            else {
                console.error(`Error reading or parsing route data file for LineRef ${lineRef}:`, error);
            }
            routeData[lineRef] = []; // Assign empty array if file fails to load
        }
    }
    return routeData;
}
/**
 * Finds the nearest pre-calculated route point to a given bus location.
 */
function findNearestRoutePoint(busLat, busLon, routePoints) {
    if (!routePoints || routePoints.length === 0) {
        return null;
    }
    let nearestPoint = null;
    let minDistance = Infinity;
    for (const point of routePoints) {
        const distance = calculateDistance(busLat, busLon, point.latitude, point.longitude);
        if (distance < minDistance) {
            minDistance = distance;
            nearestPoint = point;
        }
    }
    // Optionally add a threshold: if (minDistance > SOME_THRESHOLD_KM) return null;
    return nearestPoint;
}
// --- Lambda Handler ---
const handler = async (event, context) => {
    // 1. Get Environment Variables
    const apiKey = process.env.BUS_API_KEY;
    const busStopALatitudeStr = process.env.BUS_STOP_A_LATITUDE;
    const busStopALongitudeStr = process.env.BUS_STOP_A_LONGITUDE;
    const busStopALineRefsStr = process.env.BUS_STOP_A_LINEREFS;
    // 2. Validate Environment Variables
    if (!apiKey ||
        !busStopALatitudeStr ||
        !busStopALongitudeStr ||
        !busStopALineRefsStr) {
        console.error('Missing required environment variables');
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'Missing required environment variables',
            }),
        };
    }
    const busStopALatitude = parseFloat(busStopALatitudeStr);
    const busStopALongitude = parseFloat(busStopALongitudeStr);
    const busStopALineRefs = busStopALineRefsStr
        .replace(/[\[\]]/g, '')
        .split(',')
        .map((ref) => ref.trim().replace(/^['"]|['"]$/g, ''))
        .filter((ref) => ref !== '');
    if (isNaN(busStopALatitude) ||
        isNaN(busStopALongitude) ||
        busStopALineRefs.length === 0) {
        console.error('Invalid latitude, longitude, or empty LineRefs in environment variables');
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'Invalid or missing geo-coordinates or LineRefs',
            }),
        };
    }
    // 3. Load Route Data (Do this once per invocation)
    const routeData = await loadRouteData(busStopALineRefs);
    // 4. Fetch Real-time Bus Data
    const apiUrl = `https://data.bus-data.dft.gov.uk/api/v1/datafeed/788/?api_key=${apiKey}`;
    let activities = [];
    let responseTimestampStr;
    try {
        console.log(`Fetching data from: ${apiUrl.replace(apiKey, '***')}`);
        const response = await axios_1.default.get(apiUrl);
        const xmlData = response.data;
        console.log('Parsing XML data...');
        const parsedData = await (0, xml2js_1.parseStringPromise)(xmlData);
        // Extract overall response timestamp
        responseTimestampStr =
            parsedData?.Siri?.ServiceDelivery?.[0]?.VehicleMonitoringDelivery?.[0]
                ?.ResponseTimestamp?.[0];
        activities =
            parsedData?.Siri?.ServiceDelivery?.[0]?.VehicleMonitoringDelivery?.[0]
                ?.VehicleActivity || [];
        if (!Array.isArray(activities)) {
            console.warn('VehicleActivity data is not an array, setting to empty.');
            activities = [];
        }
    }
    catch (error) {
        console.error('Error fetching or parsing bus API data:', error);
        // Decide if you want to return an error or an empty list if API fails
        return {
            statusCode: 502,
            body: JSON.stringify({
                message: 'Failed to fetch or parse bus API data',
            }),
        };
    }
    console.log(`Processing ${activities.length} vehicle activities...`);
    // Parse the overall response time ONCE
    let responseTimeMs = null;
    if (responseTimestampStr) {
        try {
            responseTimeMs = new Date(responseTimestampStr).getTime();
            if (isNaN(responseTimeMs))
                responseTimeMs = null; // Handle invalid date string
        }
        catch (e) {
            console.warn(`Could not parse overall ResponseTimestamp: ${responseTimestampStr}`);
            responseTimeMs = null;
        }
    }
    // 5. Filter and Enrich Bus Data
    const filteredAndEnrichedBuses = activities
        .filter((activity) => {
        // Initial filtering logic (same as before)
        const journey = activity?.MonitoredVehicleJourney?.[0];
        const location = journey?.VehicleLocation?.[0];
        const lineRef = journey?.LineRef?.[0];
        const directionRef = journey?.DirectionRef?.[0];
        const latitudeStr = location?.Latitude?.[0];
        if (!journey || !location || !lineRef || !directionRef || !latitudeStr)
            return false;
        const latitude = parseFloat(latitudeStr);
        if (isNaN(latitude))
            return false;
        const trimmedLineRef = lineRef.trim();
        const isTargetLine = busStopALineRefs.includes(trimmedLineRef);
        if (!isTargetLine)
            return false;
        // const isInbound = directionRef === 'outbound'; // Removed direction filter
        // if (!isInbound) return false; // Removed direction filter
        const isNorthOfStop = latitude > busStopALatitude;
        if (!isNorthOfStop)
            return false;
        return true; // Keep this bus for enrichment
    })
        .map((activity) => {
        // Enrichment logic: Find nearest point and estimate time
        const journey = activity.MonitoredVehicleJourney[0]; // We know these exist from filter
        const location = journey.VehicleLocation[0];
        const lineRef = journey.LineRef[0].trim();
        const blockRef = journey.BlockRef?.[0] ?? null;
        const busLat = parseFloat(location.Latitude[0]);
        const busLon = parseFloat(location.Longitude[0]);
        const latLonString = `${busLat} ${busLon}`; // Create combined string
        // Get the RecordedAtTime for this specific activity
        const recordedAtTimeStr = activity.RecordedAtTime?.[0]; // Get RecordedAtTime
        let dataAgeMinutes = null;
        if (responseTimeMs && recordedAtTimeStr) {
            try {
                const recordedTimeMs = new Date(recordedAtTimeStr).getTime();
                if (!isNaN(recordedTimeMs)) {
                    const ageMillis = responseTimeMs - recordedTimeMs;
                    dataAgeMinutes = Math.round(ageMillis / 60000); // Calculate age in minutes
                }
                else {
                    console.warn(`Could not parse RecordedAtTime: ${recordedAtTimeStr}`);
                }
            }
            catch (e) {
                console.warn(`Could not parse RecordedAtTime: ${recordedAtTimeStr}`);
            }
        }
        const pointsForRoute = routeData[lineRef] || []; // Get pre-calculated points for this bus's route
        const nearestPoint = findNearestRoutePoint(busLat, busLon, pointsForRoute);
        return {
            latitude: busLat,
            longitude: busLon,
            latLonString: latLonString, // Add combined string to output
            estimatedMinutesAway: nearestPoint ? nearestPoint.minutesAway : null,
            lineRef: lineRef, // Include LineRef in output
            dataAgeMinutes: dataAgeMinutes, // Add the calculated age
            blockRef: blockRef, // Add blockRef
        };
    });
    console.log(`Found ${filteredAndEnrichedBuses.length} matching buses north of stop A.`);
    console.log('Filtered Bus Locations with Estimates:', JSON.stringify(filteredAndEnrichedBuses, null, 2));
    // 6. Return Result
    return {
        statusCode: 200,
        body: JSON.stringify(filteredAndEnrichedBuses),
    };
};
exports.handler = handler;
