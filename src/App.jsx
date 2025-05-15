import React, { useEffect, useState } from 'react';
import SplashScreen from './Component/SplashScreen';
import Home from './Pages/Home';
import './index.css';

function App() {
  const [showSplash, setShowSplash] = useState(!localStorage.getItem('splashShown'));

  useEffect(() => {
    if (showSplash) {
      const timer = setTimeout(() => {
        setShowSplash(false); // Change to false to switch to Home
        localStorage.setItem('splashShown', 'true');
      }, 4500); // 4.5 seconds

      return () => clearTimeout(timer);
    }
  }, [showSplash]);

  return (
    <div>
      {showSplash ? <SplashScreen /> : <Home />}
    </div>
  );
}

export default App;