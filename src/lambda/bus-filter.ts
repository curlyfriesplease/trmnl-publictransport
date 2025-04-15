import { Handler } from 'aws-lambda';
import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

interface VehicleActivity {
  MonitoredVehicleJourney: [
    {
      LineRef: [string];
      DirectionRef: [string];
      VehicleLocation: [
        {
          Latitude: [string];
          Longitude: [string];
        }
      ];
    }
  ];
}

interface BusLocation {
  latitude: number;
  longitude: number;
}

export const handler: Handler = async (event, context) => {
  const apiKey = process.env.BUS_API_KEY;
  const busStopALatitudeStr = process.env.BUS_STOP_A_LATITUDE;
  const busStopALongitudeStr = process.env.BUS_STOP_A_LONGITUDE;
  const busStopALineRefsStr = process.env.BUS_STOP_A_LINEREFS;

  if (
    !apiKey ||
    !busStopALatitudeStr ||
    !busStopALongitudeStr ||
    !busStopALineRefsStr
  ) {
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
    .map((ref) => ref.trim()) // Trim whitespace
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
    const response = await axios.get(apiUrl);
    const xmlData = response.data;

    console.log('Parsing XML data...');
    const parsedData = await parseStringPromise(xmlData);

    const activities: VehicleActivity[] =
      parsedData?.Siri?.ServiceDelivery?.[0]?.VehicleMonitoringDelivery?.[0]
        ?.VehicleActivity;

    if (!activities || !Array.isArray(activities)) {
      console.log('No VehicleActivity data found in the response.');
      return {
        statusCode: 200,
        body: JSON.stringify([]),
      };
    }

    console.log(`Processing ${activities.length} vehicle activities...`);

    const filteredBuses: BusLocation[] = activities
      .filter((activity) => {
        const journey = activity?.MonitoredVehicleJourney?.[0];
        const location = journey?.VehicleLocation?.[0];
        const lineRef = journey?.LineRef?.[0];
        const directionRef = journey?.DirectionRef?.[0];
        const latitudeStr = location?.Latitude?.[0];

        if (
          !journey ||
          !location ||
          !lineRef ||
          !directionRef ||
          !latitudeStr
        ) {
          // Log missing data for debugging if needed
          // console.warn('Skipping activity due to missing data:', JSON.stringify(activity));
          return false;
        }

        const latitude = parseFloat(latitudeStr);
        if (isNaN(latitude)) {
          // console.warn('Skipping activity due to invalid latitude:', latitudeStr);
          return false;
        }

        const isTargetLine = busStopALineRefs.includes(lineRef);
        const isInbound = directionRef === 'inbound';
        const isNorthOfStop = latitude > busStopALatitude;

        return isTargetLine && isInbound && isNorthOfStop;
      })
      .map((activity) => {
        const location = activity.MonitoredVehicleJourney[0].VehicleLocation[0];
        const latitude = parseFloat(location.Latitude[0]);
        const longitude = parseFloat(location.Longitude[0]);
        return { latitude, longitude };
      });

    console.log(
      `Found ${filteredBuses.length} matching buses north of stop A.`
    );
    console.log(
      'Filtered Bus Locations:',
      JSON.stringify(filteredBuses, null, 2)
    );

    return {
      statusCode: 200,
      body: JSON.stringify(filteredBuses),
    };
  } catch (error) {
    console.error('Error fetching or processing bus data:', error);
    let errorMessage = 'Internal Server Error';
    if (axios.isAxiosError(error)) {
      errorMessage = error.response?.data || error.message;
    } else if (error instanceof Error) {
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
