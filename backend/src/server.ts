import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();

app.listen(config.PORT, () => {
  console.log(`Lion Finance API running at http://localhost:${config.PORT}`);
});
