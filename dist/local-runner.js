"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bus_filter_1 = require("./lambda/bus-filter");
// Mock the AWS Lambda event and context objects (adjust if your handler uses them)
const mockEvent = {};
const mockContext = {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'local-bus-filter',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:local-bus-filter',
    memoryLimitInMB: '128',
    awsRequestId: 'local-request-id',
    logGroupName: '/aws/lambda/local-bus-filter',
    logStreamName: 'local-log-stream',
    getRemainingTimeInMillis: () => 30000, // 30 seconds
    done: (error, result) => {
        if (error) {
            console.error('done error:', error);
        }
        if (result) {
            console.log('done result:', result);
        }
    },
    fail: (error) => {
        console.error('fail error:', error);
    },
    succeed: (messageOrObject) => {
        console.log('succeed result:', messageOrObject);
    },
};
// Define an async function to call the handler
const runLocal = async () => {
    console.log('Running handler locally...');
    try {
        // Call the handler function
        // The handler expects an event and context, but might not use them.
        // Provide empty objects or minimal mocks as needed.
        const result = await (0, bus_filter_1.handler)(mockEvent, mockContext, () => { }); // The third callback argument is often needed
        console.log('\n--- Handler Result ---');
        console.log('Status Code:', result?.statusCode);
        console.log('Body:', result?.body ? JSON.parse(result.body) : result?.body);
        console.log('--------------------');
    }
    catch (error) {
        console.error('\n--- Handler Error ---');
        console.error(error);
        console.log('--------------------');
    }
};
// Execute the local runner function
runLocal();
