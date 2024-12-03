import React from 'react';
import { Link } from 'react-router-dom';


const SomethingWentWrong: React.FC = () => {
  return (
    <div className="container mx-auto flex flex-col items-center justify-center min-h-screen p-4">
      <h1 className="text-3xl font-semibold mb-4">Something Went Wrong</h1>
      <p className="mb-4">We're sorry, but something went wrong on our end.</p>
      <p>Please try again later or return to the homepage.</p>
      <Link to="/" className="mt-4 px-4 py-2 bg-blue-600 text-white rounded">
        Go to Homepage
      </Link>
    </div>
  );
};

export default SomethingWentWrong; 