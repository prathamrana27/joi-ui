function ChatMessage({ role, content, timestamp }) {
    return (
      <div className="message-fade-in">
        <div
          className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'} mb-2`}
        >
          <div
            className={`max-w-md p-3 rounded-lg transition-all duration-300 ${
              role === 'user' ? 'bg-blue-100 text-gray-100' : 'bg-gray-200 text-gray-100'
            }`}
          >
            <div>{content}</div>
            <div className="text-xs text-gray-100 mt-1">
              {new Date(timestamp).toLocaleTimeString()}
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  export default ChatMessage;