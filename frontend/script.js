//test for now
const socket = new WebSocket("ws://localhost:8080/ws/prices");

socket.onopen = () => {
  console.log("Connected to price feed");
};

socket.onmessage = (event) => {
  console.log("Price update:", event.data);
};