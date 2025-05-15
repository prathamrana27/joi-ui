import { useState, useEffect, useRef } from 'react';
import ChatMessage from '../Component/ChatMessage';
import { FaPlus, FaPaperPlane, FaBars, FaMoon, FaSun, FaEnvelope, FaCalendarAlt, FaFilePdf, FaImage } from 'react-icons/fa';

function Home() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [theme, setTheme] = useState('dark');
  const [selectedFile, setSelectedFile] = useState(null); // New state for selected file
  const dropdownRef = useRef(null);
  const wsRef = useRef(null);
  const chatContainerRef = useRef(null);
  const fileInputRef = useRef(null); // New ref for file input
  const clientId = '123';

  // Load conversation history from local storage on mount
  useEffect(() => {
    const storedHistory = JSON.parse(localStorage.getItem('conversationHistory') || '[]');
    setHistory(storedHistory);
  }, []);

  // Initialize WebSocket connection
  useEffect(() => {
    const ws = new WebSocket(`ws://localhost:8000/ws/${clientId}`);
    wsRef.current = ws;

    // Accumulate chunks and manage streaming
    let accumulatedResponse = '';
    let wordQueue = [];
    let isProcessingQueue = false;
    let isDateQuery = false;

    // Clean response
    const cleanResponse = (text) => {
      return text
        .replace(/TOOL_CALL::.*?}/g, '') // Remove TOOL_CALL and its content
        .replace(/TOOL_CALL/g, '') // Remove standalone TOOL_CALL
        .replace(/(\*\*|`{1,3}|\n{2,})/g, '') // Remove Markdown
        .replace(/Let me (fetch|check|help|explain).*?\./gi, '') // Remove boilerplate
        .replace(/Let me know if.*$/gi, '')
        .replace(/Here's a simple.*?:/gi, '') // Remove "Here's a simple..."
        .replace(/###\s*How to run.*?(?=\n|$)/gis, '')
        .replace(/(\d+\.\s*.*?)(?=\n|$)/g, '') // Remove numbered lists
        .trim();
    };

    // Format response
    const formatResponse = (text) => {
      // Handle date responses
      if (isDateQuery) {
        const dateMatch = text.match(/(\w+ \d{1,2}, \d{4})|(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
          const date = new Date(dateMatch[0]);
          if (!isNaN(date)) {
            return `Today's date is ${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()}`;
          }
        }
      }

      // Handle multiple code blocks
      const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
      let formatted = text;
      let codeBlocks = [];
      let match;
      while ((match = codeBlockRegex.exec(text)) !== null) {
        const lang = match[1] || 'text';
        const code = match[2].trim();
        const codeId = `code-${Math.random().toString(36).substr(2, 9)}`;
        const html = `
          <div class="code-block">
            <div class="code-header">
              <span class="code-lang">${lang}</span>
              <button class="code-btn copy-btn" data-code-id="${codeId}">Copy</button>
              <button class="code-btn edit-btn" data-code-id="${codeId}">Edit</button>
            </div>
            <pre><code class="language-${lang}" id="${codeId}">${code}</code></pre>
          </div>
        `;
        codeBlocks.push({ original: match[0], html });
      }

      // Replace code blocks and clean surrounding text
      let lastIndex = 0;
      let result = '';
      codeBlocks.forEach(({ original, html }, index) => {
        const startIndex = text.indexOf(original, lastIndex);
        const beforeText = cleanResponse(text.slice(lastIndex, startIndex)).trim();
        if (beforeText) result += `${beforeText}<br><br>`;
        result += html;
        lastIndex = startIndex + original.length;
        if (index === codeBlocks.length - 1) {
          const afterText = cleanResponse(text.slice(lastIndex)).trim();
          if (afterText) result += `<br><br>${afterText}`;
        }
      });

      if (!codeBlocks.length) {
        return cleanResponse(text);
      }
      return result;
    };

    // Process word queue for streaming
    const processWordQueue = () => {
      if (wordQueue.length === 0) {
        isProcessingQueue = false;
        return;
      }
      isProcessingQueue = true;
      const word = wordQueue.shift();
      setMessages((prevMessages) => {
        const lastMessage = prevMessages[prevMessages.length - 1];
        if (lastMessage && lastMessage.role === 'assistant' && lastMessage.isStreaming) {
          return [
            ...prevMessages.slice(0, -1),
            {
              ...lastMessage,
              content: lastMessage.content + (lastMessage.content && !lastMessage.content.endsWith('<br><br>') ? ' ' : '') + word,
            },
          ];
        } else {
          return [
            ...prevMessages,
            {
              role: 'assistant',
              content: word,
              timestamp: new Date().toISOString(),
              isStreaming: true,
            },
          ];
        }
      });
      setTimeout(processWordQueue, 50); // Faster streaming for large prompts
    };

    ws.onopen = () => {
      console.log(`Connected to ws://localhost:8000/ws/${clientId}`);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'ai_chunk') {
          accumulatedResponse += data.payload;
          isDateQuery = isDateQuery || data.payload.toLowerCase().includes('date') || data.payload.match(/(\w+ \d{1,2}, \d{4})|(\d{4}-\d{2}-\d{2})/);

          // Process chunks more incrementally for large prompts
          const codeBlockMatch = accumulatedResponse.match(/```(\w*)\n([\s\S]*?)```/);
          const isComplete = codeBlockMatch || accumulatedResponse.length > 20 || data.payload.includes('\n');

          if (isComplete) {
            const formatted = formatResponse(accumulatedResponse);
            const segments = formatted.includes('<div class="code-block"')
              ? [formatted] // Send code block as a single unit
              : formatted.split(/(<br><br>|\s+)/).filter(segment => segment && segment !== '<br><br>'); // Split by spaces or <br><br>
            wordQueue = [...wordQueue, ...segments];

            accumulatedResponse = ''; // Reset after processing
            if (!isProcessingQueue) {
              processWordQueue();
            }
          }
        } else if (data.type === 'error') {
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: `Error: ${data.payload}`,
              timestamp: new Date().toISOString(),
              isStreaming: false,
            },
          ]);
        } else if (data.type === 'model_connected') {
          console.log(data.payload);
        } else if (data.type === 'stream_end') {
          // Process any remaining accumulated response
          if (accumulatedResponse) {
            const formatted = formatResponse(accumulatedResponse);
            const segments = formatted.includes('<div class="code-block"')
              ? [formatted]
              : formatted.split(/(<br><br>|\s+)/).filter(segment => segment && segment !== '<br><br>');
            wordQueue = [...wordQueue, ...segments];
            accumulatedResponse = '';
            if (!isProcessingQueue) {
              processWordQueue();
            }
          }
          // Finalize stream
          const finalizeStream = () => {
            if (wordQueue.length === 0 && !isProcessingQueue) {
              setMessages((prev) =>
                prev.map((msg, i) =>
                  i === prev.length - 1 ? { ...msg, isStreaming: false } : msg
                )
              );
              isDateQuery = false; // Reset for next message
            } else {
              setTimeout(finalizeStream, 50);
            }
          };
          finalizeStream();
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Failed to connect to the server. Please try again.',
          timestamp: new Date().toISOString(),
          isStreaming: false,
        },
      ]);
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
    };

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [clientId]);

  // Handle clicks outside dropdown to close it
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Update messages when user types
  useEffect(() => {
    if (input.trim() && messages.length === 1 && messages[0].content === 'Hi there! 😊 How can I help you today?') {
      setMessages([]);
    } else if (!input.trim() && messages.length === 0) {
      setMessages([
        { role: 'assistant', content: 'Hi there! 😊 How can I help you today?', timestamp: new Date().toISOString() },
      ]);
    }
  }, [input, messages.length]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Handle Copy and Edit button clicks
  useEffect(() => {
    const handleButtonClick = (event) => {
      if (event.target.classList.contains('copy-btn')) {
        const codeId = event.target.getAttribute('data-code-id');
        const codeElement = document.getElementById(codeId);
        if (codeElement) {
          navigator.clipboard.writeText(codeElement.textContent);
          alert('Code copied to clipboard!');
        }
      } else if (event.target.classList.contains('edit-btn')) {
        const codeId = event.target.getAttribute('data-code-id');
        const codeElement = document.getElementById(codeId);
        if (codeElement) {
          setInput(codeElement.textContent);
        }
      }
    };
    document.addEventListener('click', handleButtonClick);
    return () => {
      document.removeEventListener('click', handleButtonClick);
    };
  }, []);

  // Handle file selection
  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file && file.type === 'application/pdf') {
      setSelectedFile(file);
      setInput('Summarize this PDF');
      // Optionally send the file to the server via WebSocket
      if (wsRef.current && file) {
        const reader = new FileReader();
        reader.onload = () => {
          wsRef.current.send(
            JSON.stringify({
              type: 'upload_pdf',
              payload: {
                fileName: file.name,
                fileData: reader.result, // Base64 encoded file
              },
            })
          );
        };
        reader.readAsDataURL(file);
      }
    } else {
      alert('Please select a valid PDF file.');
    }
  };

  const handleSend = () => {
    if (!input.trim() || !wsRef.current) return;

    const userMessage = { role: 'user', content: input, timestamp: new Date().toISOString() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);

    wsRef.current.send(
      JSON.stringify({
        type: 'user_message',
        payload: input,
        model: 'openai',
      })
    );

    setInput('');
    setSelectedFile(null); // Reset selected file after sending

    let updatedHistory;
    if (currentConversationId) {
      updatedHistory = history.map((conv) =>
        conv.id === currentConversationId ? { ...conv, messages: newMessages } : conv
      );
    } else {
      const newConversation = {
        id: Date.now().toString(),
        messages: newMessages,
        snippet: input.slice(0, 30) + (input.length > 30 ? '...' : ''),
        timestamp: new Date().toISOString(),
      };
      updatedHistory = [...history, newConversation];
      setCurrentConversationId(newConversation.id);
    }
    setHistory(updatedHistory);
    localStorage.setItem('conversationHistory', JSON.stringify(updatedHistory));
  };

  const handleLoadConversation = (conversationId) => {
    const conversation = history.find((conv) => conv.id === conversationId);
    if (conversation) {
      setMessages(conversation.messages);
      setCurrentConversationId(conversationId);
      if (wsRef.current) {
        wsRef.current.send(
          JSON.stringify({
            type: 'load_chat',
            payload: { conversationId },
          })
        );
      }
    }
    setIsSidebarOpen(false);
  };

  const handleNewConversation = () => {
    setMessages([
      { role: 'assistant', content: 'Hi there! 😊 How can I help you today?', timestamp: new Date().toISOString() },
    ]);
    setCurrentConversationId(null);
    setInput('');
    setSelectedFile(null); // Reset selected file
    setIsSidebarOpen(false);
    if (wsRef.current) {
      wsRef.current.send(
        JSON.stringify({
          type: 'start_chat',
          payload: {},
        })
      );
    }
  };

  const handleOptionClick = (option) => {
    console.log(`${option} clicked`);
    switch (option) {
      case 'Send a email':
        setInput('Write an email for me');
        break;
      case 'Set Calender':
        setInput('Set a calendar event');
        break;
      case 'Summarize pdf':
        setInput('Summarize this PDF');
        if (fileInputRef.current) {
          fileInputRef.current.click(); // Trigger file input dialog
        }
        break;
      case 'Create image':
        setInput('Generate an image');
        break;
      default:
        setInput('');
    }
  };

  const handleDropdownOption = (option) => {
    consolemu
    console.log(`${option} clicked`);
    setIsDropdownOpen(false);
    if (wsRef.current) {
      wsRef.current.send(
        JSON.stringify({
          type: 'connect_model',
          payload: option,
        })
      );
    }
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const userQueries = history.map((conv) => ({
    id: conv.id,
    query: conv.messages.find((msg) => msg.role === 'user')?.content || 'Untitled',
    timestamp: conv.timestamp,
  }));

  return (
    <div className={`min-h-screen w-full flex flex-col overflow-hidden ${theme === 'dark' ? 'bg-black' : 'bg-gray-100'}`}>
      {/* Theme Toggle Button in Top-Right Corner */}
      <div className="fixed top-4 right-4 z-30">
        <button
          onClick={toggleTheme}
          className={`p-2 ${theme === 'dark' ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:text-gray-800'} rounded-full transition-colors duration-200`}
        >
          {theme === 'dark' ? <FaSun className="w-5 h-5" /> : <FaMoon className="w-5 h-5" />}
        </button>
      </div>

      {/* Header with Buttons and Project Name */}
      <div
        className={`fixed top-0 left-0 w-full h-16 flex items-center space-x-3 px-4 z-20 ${theme === 'dark' ? 'bg-black' : 'bg-white'} ${
          isSidebarOpen ? 'ml-72' : 'ml-0'
        } transition-all duration-300 ease-in-out`}
      >
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className={`p-2 ${theme === 'dark' ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:text-gray-800'} rounded-full transition-colors duration-200`}
          title="History"
        >
          <FaBars className="w-5 h-5" />
        </button>
        <button
          onClick={handleNewConversation}
          className={`flex items-center space-x-1 px-3 py-2 ${theme === 'dark' ? 'bg-gray-800 text-gray-200 hover:bg-gray-600' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'} rounded-full transition-colors duration-200`}
          title="New Chat"
        >
          <FaPlus className="w-4 h-4" />
          <span className="text-sm font-medium">New Chat</span>
        </button>
        <h1 className={`text-xl font-semibold ${theme === 'dark' ? 'text-gray-200' : 'text-gray-800'}`}>
          JOI
        </h1>
      </div>

      {/* Main Layout */}
      <div className="flex flex-1 pt-16">
        {/* Sidebar */}
        <div
          className={`fixed inset-y-0 left-0 w-72 ${theme === 'dark' ? 'bg-black' : 'bg-white'} transform ${
            isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          } transition-transform duration-300 ease-in-out z-10 mt-16`}
        >
          <div className="h-full flex flex-col">
            {/* Top-left Logo/Text */}
            <div className="p-4">
              <h2 className={`text-base font-bold ${theme === 'dark' ? 'text-gray-200' : 'text-gray-800'}`}>JOI</h2>
              <h2 className={`text-sm font-semibold ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>History</h2>
            </div>

            {/* Scrollable Chat History */}
            <div className="flex-1 overflow-y-auto px-4 space-y-2">
              {userQueries.length === 0 ? (
                <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>No chat history yet.</p>
              ) : (
                userQueries.map((query) => (
                  <div
                    key={query.id}
                    onClick={() => handleLoadConversation(query.id)}
                    className={`p-3 ${theme === 'dark' ? 'bg-gray-800 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'} rounded-lg cursor-pointer transition-colors duration-200`}
                  >
                    <p className={`text-sm truncate ${theme === 'dark' ? 'text-gray-200' : 'text-gray-800'}`}>
                      {query.query}
                    </p>
                    <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                      {new Date(query.timestamp).toLocaleString()}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div
          className={`flex-1 flex flex-col transition-all duration-300 ease-in-out ${
            isSidebarOpen ? 'ml-72' : 'ml-0'
          }`}
        >
          {/* Chat Area */}
          <div
            ref={chatContainerRef}
            className={`flex-1 px-4 py-6 overflow-y-auto ${theme === 'dark' ? 'bg-black' : 'bg-gray-100'} flex flex-col max-h-[calc(100vh-16rem)]`}
          >
            {messages.length === 1 && messages[0].content === 'Hi there! 😊 How can I help you today?' ? (
              <div className="flex-1 flex items-center justify-center">
                <p className={`text-lg font-medium ${theme === 'dark' ? 'text-gray-200' : 'text-gray-800'}`}>
                  Hi there! 😊 How can I help you today?
                </p>
              </div>
            ) : (
              <div className="max-w-3xl mx-auto w-full">
                {messages.map((msg, index) => (
                  <div
                    key={index}
                    className={`mb-4 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}
                  >
                    <div
                      className={`inline-block p-3 rounded-lg ${theme === 'dark' ? 'bg-gray-800 text-gray-200' : 'bg-gray-200 text-gray-800'} max-w-md`}
                    >
                      <div className="text-left" dir="ltr" dangerouslySetInnerHTML={{ __html: msg.content }} />
                      <span className={`text-xs block mt-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                        {new Date(msg.timestamp).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Chat Input Area */}
          <div className={`px-4 py-6 ${theme === 'dark' ? 'bg-black' : 'bg-white'}`}>
            <div className="max-w-3xl mx-auto">
              <div className="space-y-3">
                {/* Hidden File Input */}
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="application/pdf"
                  onChange={handleFileChange}
                  className="hidden"
                />

                {/* Input Field and Send Button */}
                <div className={`flex items-center ${theme === 'dark' ? 'bg-black' : 'bg-gray-200'} rounded-lg p-3`}>
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                    className={`flex-1 p-2 bg-transparent rounded-lg ${theme === 'dark' ? 'text-gray-200 placeholder-gray-400' : 'text-gray-800 placeholder-gray-500'} border-none focus:outline-none focus:ring-0`}
                    placeholder="Ask anything"
                  />
                  <button
                    onClick={handleSend}
                    className={`p-2 ${theme === 'dark' ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'} rounded-lg transition-colors duration-200 ml-2`}
                  >
                    <FaPaperPlane className="w-5 h-5" />
                  </button>
                </div>

                {/* Display Selected File Name */}
                {selectedFile && (
                  <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                    Selected: {selectedFile.name}
                  </p>
                )}

                {/* Options Row */}
                <div className="flex items-center justify-between">
                  {/* Left Side Options */}
                  <div className="flex items-center space-x-2">
                    <div className="relative" ref={dropdownRef}>
                      <button
                        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                        className={`flex items-center justify-center w-9 h-9 ${theme === 'dark' ? 'bg-gray-800 text-gray-200 hover:bg-gray-600' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'} rounded-full transition-colors duration-200`}
                      >
                        <FaPlus className="w-4 h-4" />
                      </button>
                      {isDropdownOpen && (
                        <div className={`absolute bottom-12 left-0 w-48 ${theme === 'dark' ? 'bg-gray-800' : 'bg-gray-200'} rounded-lg z-10`}>
                          <button
                            onClick={() => handleDropdownOption('Connect with Open AI')}
                            className={`w-full text-left px-3 py-2 ${theme === 'dark' ? 'text-gray-200 hover:bg-gray-600' : 'text-gray-800 hover:bg-gray-300'} rounded-t-lg transition-colors duration-200`}
                          >
                            Connect with Open AI
                          </button>
                          <button
                            onClick={() => handleDropdownOption('Connect with Gemini')}
                            className={`w-full text-left px-3 py-2 ${theme === 'dark' ? 'text-gray-200 hover:bg-gray-600' : 'text-gray-800 hover:bg-gray-300'} rounded-b-lg transition-colors duration-200`}
                          >
                            Connect with Gemini
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleOptionClick('Send a email')}
                      className={`flex items-center space-x-1 px-3 py-2 ${theme === 'dark' ? 'bg-gray-800 text-gray-200 hover:bg-gray-600' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'} rounded-full transition-colors duration-200`}
                    >
                      <FaEnvelope className="w-4 h-4" />
                      <span className="text-sm font-medium">Send a email</span>
                    </button>
                    <button
                      onClick={() => handleOptionClick('Set Calender')}
                      className={`flex items-center space-x-1 px-3 py-2 ${theme === 'dark' ? 'bg-gray-800 text-gray-200 hover:bg-gray-600' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'} rounded-full transition-colors duration-200`}
                    >
                      <FaCalendarAlt className="w-4 h-4" />
                      <span className="text-sm font-medium">Set Calender</span>
                    </button>
                    <button
                      onClick={() => handleOptionClick('Summarize pdf')}
                      className={`flex items-center space-x-1 px-3 py-2 ${theme === 'dark' ? 'bg-gray-800 text-gray-200 hover:bg-gray-600' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'} rounded-full transition-colors duration-200`}
                    >
                      <FaFilePdf className="w-4 h-4" />
                      <span className="text-sm font-medium">Summarize pdf</span>
                    </button>
                    <button
                      onClick={() => handleOptionClick('Create image')}
                      className={`flex items-center space-x-1 px-3 py-2 ${theme === 'dark' ? 'bg-gray-800 text-gray-200 hover:bg-gray-600' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'} rounded-full transition-colors duration-200`}
                    >
                      <FaImage className="w-4 h-4" />
                      <span className="text-sm font-medium">Create image</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Home;