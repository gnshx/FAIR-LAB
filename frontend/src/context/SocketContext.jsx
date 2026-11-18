import React, { createContext, useContext, useEffect, useState, useRef } from 'react';

const SocketContext = createContext();

export function SocketProvider({ children }) {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState(null);
  const listenersRef = useRef(new Map());

  useEffect(() => {
    let ws;
    let timer;

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.hostname}:5000`;
      
      try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          setConnected(true);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            setLastEvent(data);

            const listeners = listenersRef.current.get(data.type);
            if (listeners) {
              listeners.forEach(fn => fn(data.payload));
            }
          } catch (e) {
            console.error('Socket message parse error', e);
          }
        };

        ws.onclose = () => {
          setConnected(false);
          timer = setTimeout(connect, 3000); // Reconnect
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch (err) {
        timer = setTimeout(connect, 3000);
      }
    }

    connect();

    return () => {
      clearTimeout(timer);
      if (ws) ws.close();
    };
  }, []);

  const subscribe = (eventType, callback) => {
    if (!listenersRef.current.has(eventType)) {
      listenersRef.current.set(eventType, new Set());
    }
    listenersRef.current.get(eventType).add(callback);

    return () => {
      const set = listenersRef.current.get(eventType);
      if (set) {
        set.delete(callback);
      }
    };
  };

  return (
    <SocketContext.Provider value={{ connected, lastEvent, subscribe }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}

