import { installRuntime } from '../src/money-maker-runtime.mjs';
const args = process.argv.slice(2);
if (args.length !== 1 && args.length !== 2) throw new Error('Usage: node scripts/setup-offline-runtime.mjs PRODUCER_CHECKOUT [PRIVATE_RUNTIME_ROOT]');
await installRuntime({ producerCheckout: args[0], runtimeRoot: args[1] });
console.log('Verified pinned private offline runtime installed; producer checkout unchanged.');
