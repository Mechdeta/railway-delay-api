import { app, PORT } from './app';
import { X402Config } from './payment/x402';

// Validate payment configuration before starting the server
X402Config.validate();

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});