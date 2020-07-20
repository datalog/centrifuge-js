# Centrifuge client for browser
This is playground based on https://github.com/centrifugal/centrifuge-js

## Install and quick start

Just download and include centrifuge.js into your web page using `script` tag:

```html
<script src="centrifuge.js"></script>
```

Create new `Centrifuge` object instance, subscribe on channel and call `.connect()` method to make actual connection to server:

```javascript
var centrifuge = new myCentrifuge('ws://centrifuge.example.com/connection/websocket');

centrifuge.subscribe("news", function(message) {
  console.log(message);
});

centrifuge.connect();
```

Check original documentation if needed.
