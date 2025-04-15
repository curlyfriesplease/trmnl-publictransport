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
// Load environment variables from .env file
dotenv.config();
const handler = async (event, context) => {
    const apiKey = process.env.BUS_API_KEY;
    const busStopALatitudeStr = process.env.BUS_STOP_A_LATITUDE;
    const busStopALongitudeStr = process.env.BUS_STOP_A_LONGITUDE;
    const busStopALineRefsStr = process.env.BUS_STOP_A_LINEREFS;
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
    // Parse BUS_STOP_A_LINEREFS (e.g., "[27]" or "[5,5A]")
    const busStopALineRefs = busStopALineRefsStr
        .replace(/[\[\]]/g, '') // Remove brackets
        .split(',') // Split by comma
        .map((ref) => {
        const trimmedRef = ref.trim();
        // Remove surrounding quotes (single or double) if present
        return trimmedRef.replace(/^['"]|['"]$/g, '');
    })
        .filter((ref) => ref !== ''); // Remove empty strings
    if (isNaN(busStopALatitude) || isNaN(busStopALongitude)) {
        console.error('Invalid latitude or longitude in environment variables');
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'Invalid latitude or longitude in environment variables',
            }),
        };
    }
    const apiUrl = `https://data.bus-data.dft.gov.uk/api/v1/datafeed/788/?api_key=${apiKey}`;
    try {
        console.log(`Fetching data from: ${apiUrl.replace(apiKey, '***')}`); // Avoid logging API key
        const response = await axios_1.default.get(apiUrl);
        const xmlData = response.data;
        console.log('Parsing XML data...');
        const parsedData = await (0, xml2js_1.parseStringPromise)(xmlData);
        const activities = parsedData?.Siri?.ServiceDelivery?.[0]?.VehicleMonitoringDelivery?.[0]
            ?.VehicleActivity;
        if (!activities || !Array.isArray(activities)) {
            console.log('No VehicleActivity data found in the response.');
            return {
                statusCode: 200,
                body: JSON.stringify([]),
            };
        }
        console.log(`Processing ${activities.length} vehicle activities...`);
        let filteredCount = 0;
        let missingDataCount = 0;
        let invalidLatCount = 0;
        let wrongLineCount = 0;
        let wrongDirectionCount = 0;
        let wrongLocationCount = 0;
        const filteredBuses = activities
            .filter((activity) => {
            const activityId = activity?.ItemIdentifier?.[0] ?? 'unknown'; // Try to get an identifier
            const journey = activity?.MonitoredVehicleJourney?.[0];
            const location = journey?.VehicleLocation?.[0];
            const lineRef = journey?.LineRef?.[0];
            const directionRef = journey?.DirectionRef?.[0];
            const latitudeStr = location?.Latitude?.[0];
            if (!journey ||
                !location ||
                !lineRef ||
                !directionRef ||
                !latitudeStr) {
                // console.warn(`[${activityId}] Skipping activity due to missing data`);
                missingDataCount++;
                return false;
            }
            const latitude = parseFloat(latitudeStr);
            if (isNaN(latitude)) {
                // console.warn(`[${activityId}] Skipping activity due to invalid latitude: ${latitudeStr}`);
                invalidLatCount++;
                return false;
            }
            // Ensure we compare trimmed strings
            const trimmedLineRef = lineRef.trim();
            const isTargetLine = busStopALineRefs.includes(trimmedLineRef);
            //  Detailed logging for the comparison
            console.log(`[${activityId}] Comparing LineRef: XML='${trimmedLineRef}' (type: ${typeof trimmedLineRef}) with Target='${busStopALineRefs.join(', ')}' (element types: ${busStopALineRefs
                .map((t) => typeof t)
                .join(', ')}) -> Match: ${isTargetLine}`);
            if (!isTargetLine) {
                // console.log(
                //   `[${activityId}] Filtering out: Incorrect LineRef (${lineRef}). Target: ${busStopALineRefs.join(
                //     ', '
                //   )}`
                // );
                wrongLineCount++;
                return false;
            }
            const isInbound = directionRef === 'outbound';
            if (!isInbound) {
                // console.log(`[${activityId}] Filtering out: Incorrect DirectionRef (${directionRef}). Target: inbound`);
                wrongDirectionCount++;
                return false;
            }
            const isNorthOfStop = latitude > busStopALatitude;
            if (!isNorthOfStop) {
                // console.log(`[${activityId}] Filtering out: South of stop (${latitude} <= ${busStopALatitude})`);
                wrongLocationCount++;
                return false;
            }
            // If all checks pass, keep the activity
            filteredCount++;
            return true;
        })
            .map((activity) => {
            const location = activity.MonitoredVehicleJourney[0].VehicleLocation[0];
            const latitude = parseFloat(location.Latitude[0]);
            const longitude = parseFloat(location.Longitude[0]);
            return { latitude, longitude };
        });
        console.log(`\nFiltering Summary:`);
        console.log(`- Total activities processed: ${activities.length}`);
        console.log(`- Skipped (missing data): ${missingDataCount}`);
        console.log(`- Skipped (invalid latitude): ${invalidLatCount}`);
        console.log(`- Filtered out (wrong line): ${wrongLineCount}`);
        console.log(`- Filtered out (wrong direction): ${wrongDirectionCount}`);
        console.log(`- Filtered out (south of stop): ${wrongLocationCount}`);
        console.log(`- Activities kept: ${filteredCount}`);
        console.log(`  (Should match final count: ${filteredBuses.length})`);
        console.log(`\nFound ${filteredBuses.length} matching buses north of stop A.`);
        console.log('Filtered Bus Locations:', JSON.stringify(filteredBuses, null, 2));
        return {
            statusCode: 200,
            body: JSON.stringify(filteredBuses),
        };
    }
    catch (error) {
        console.error('Error fetching or processing bus data:', error);
        let errorMessage = 'Internal Server Error';
        if (axios_1.default.isAxiosError(error)) {
            errorMessage = error.response?.data || error.message;
        }
        else if (error instanceof Error) {
            errorMessage = error.message;
        }
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'Failed to process bus data',
                error: errorMessage,
            }),
        };
    }
};
exports.handler = handler;
