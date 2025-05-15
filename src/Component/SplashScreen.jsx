import React from 'react';
import './SplashScreen.css';
import logo from '../assets/logo.png'; // Adjust path if needed

const SplashScreen = () => {
  return (
    <div className="splash-container">
      <div className="project-name">JOI</div>
      <div className="logo">
        <img src={logo} alt="JOI Logo" />
      </div>
    </div>
  );
};

export default SplashScreen;