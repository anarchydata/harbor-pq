/**
 * Simple test with minimal M code
 */

require('dotenv').config();
const { PowerQueryNetRunner } = require('./dist/main/powerQueryNetRunner');

const simpleMCode = `let hw = "Hello World" in hw`;

async function test() {
  console.log("Testing simple M code:", simpleMCode);
  
  const runner = new PowerQueryNetRunner();
  const response = await runner.execute({
    mText: simpleMCode,
    entry: "hw",
    settings: { rowLimit: 10, timeoutMs: 10000 }
  });
  
  console.log("Success:", response.ok);
  if (response.ok) {
    console.log("Result:", response.rows);
    console.log("Schema:", response.schema);
  } else {
    console.error("Error:", response.error);
    if (response.diagnostics) {
      console.error("Diagnostics:", response.diagnostics);
    }
  }
}

test().catch(console.error);

