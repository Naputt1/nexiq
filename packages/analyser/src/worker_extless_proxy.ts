import { parentPort } from 'node:worker_threads';
// Extensionless!
import { parseCode } from './src/analyzer/utils';
parentPort.postMessage('Imported utils successfully');
