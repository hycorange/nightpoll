// Query the Preview indexer for unshielded transactions to an address (one-shot).
import { WebSocket } from 'ws';
const addr = process.argv[2];
const ws = new WebSocket('wss://indexer.preview.midnight.network/api/v4/graphql/ws', 'graphql-transport-ws');
const q = `subscription($a: UnshieldedAddress!){ unshieldedTransactions(address:$a){ __typename ... on UnshieldedTransaction { transaction { hash block { height } } createdUtxos { value tokenType } } ... on UnshieldedTransactionsProgress { highestTransactionId } } }`;
ws.on('open', () => ws.send(JSON.stringify({ type: 'connection_init' })));
ws.on('message', (m) => {
  const d = JSON.parse(m);
  if (d.type === 'connection_ack') ws.send(JSON.stringify({ id: '1', type: 'subscribe', payload: { query: q, variables: { a: addr } } }));
  else console.log(JSON.stringify(d.payload ?? d).slice(0, 800));
});
setTimeout(() => process.exit(0), 12000);
