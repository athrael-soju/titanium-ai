'use client';

import React, { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import MessagesField from './MessagesField';
import styles from './Chat.module.css';
import Loader from './Loader';
import { useSession } from 'next-auth/react';
import CustomizedInputBase from './CustomizedInputBase';
import { retrieveAIResponse } from '@/app/services/chatService';
interface IMessage {
  text: string;
  sender: 'user' | 'ai';
  id: string;
}

const Chat = () => {
  const { data: session } = useSession();

  const [messages, setMessages] = useState<IMessage[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isAssistantEnabled, setIsAssistantEnabled] = useState<boolean>(false);

  const addUserMessageToState = (message: string) => {
    const userMessageId = uuidv4();
    setMessages((prevMessages) => [
      ...prevMessages,
      { text: `🧑‍💻 ${message}`, sender: 'user', id: userMessageId },
    ]);
  };

  const addAiMessageToState = (
    aiResponseText: string,
    aiResponseId: string
  ) => {
    setMessages((prevMessages) => [
      ...prevMessages.filter((msg) => msg.id !== aiResponseId),
      { text: `🤖 ${aiResponseText}`, sender: 'ai', id: aiResponseId },
    ]);
  };

  const processAIResponseStream = async (
    reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
    aiResponseId: string
  ) => {
    if (!reader) {
      console.error(
        'No reader available for processing the AI response stream.'
      );
      return;
    }

    const decoder = new TextDecoder();
    let aiResponseText = '';

    const processText = async ({
      done,
      value,
    }: {
      done: boolean;
      value?: Uint8Array;
    }): Promise<void> => {
      if (done) {
        // Try parsing the final accumulated text after reading is done
        try {
          const finalJson = JSON.parse(aiResponseText);
          if (finalJson?.choices[0].delta.content) {
            aiResponseText = finalJson.choices[0].delta.content;
          }
        } catch (error) {
          console.error('Failed to parse final JSON:', aiResponseText, error);
        }
        addAiMessageToState(aiResponseText, aiResponseId);
        return;
      }

      const chunk = value ? decoder.decode(value, { stream: true }) : '';
      aiResponseText += chunk;

      // Process the accumulated text only if it's a complete JSON object
      if (aiResponseText.endsWith('}\n')) {
        try {
          const json = JSON.parse(aiResponseText);
          if (json?.choices[0].delta.content) {
            aiResponseText = json.choices[0].delta.content;
            addAiMessageToState(aiResponseText, aiResponseId);
            aiResponseText = ''; // Reset the accumulated text
          }
        } catch (error) {
          console.error('Failed to parse JSON:', aiResponseText, error);
        }
      }

      return reader.read().then(processText);
    };
    await reader.read().then(processText);
  };

  const sendUserMessage = async (message: string) => {
    if (!message.trim()) return;
    try {
      setIsLoading(true);
      addUserMessageToState(message);
      const aiResponseId = uuidv4();
      const userEmail = session?.user?.email as string;
      const response = await retrieveAIResponse(
        message,
        userEmail,
        isAssistantEnabled
      );

      if (!response) return;

      if (isAssistantEnabled) {
        await processResponse(response, aiResponseId);
      } else {
        await processStream(response, aiResponseId);
      }
    } catch (error) {
      console.log(error);
    } finally {
      setIsLoading(false);
    }
  };

  async function processResponse(
    response: ReadableStreamDefaultReader<Uint8Array> | Response,
    aiResponseId: string
  ) {
    if (!(response instanceof Response)) {
      console.error('Expected a Response object, received:', response);
      return;
    }

    try {
      const contentType = response.headers.get('Content-Type');
      const data = contentType?.includes('application/json')
        ? await response.json()
        : await response.text();
      addAiMessageToState(data, aiResponseId);
    } catch (error) {
      console.error('Error processing response:', error);
    }
  }

  async function processStream(
    stream: ReadableStreamDefaultReader<Uint8Array> | Response,
    aiResponseId: string
  ) {
    if (!(stream instanceof ReadableStreamDefaultReader)) {
      console.error(
        'Expected a ReadableStreamDefaultReader object, received:',
        stream
      );
      return;
    }

    try {
      await processAIResponseStream(stream, aiResponseId);
    } catch (error) {
      console.error('Error processing stream:', error);
    }
  }

  if (session) {
    return (
      <>
        {isLoading && <Loader />}
        <MessagesField messages={messages} />
        <div className={styles.inputArea}>
          <CustomizedInputBase
            setIsLoading={setIsLoading}
            onSendMessage={sendUserMessage}
            isAssistantEnabled={isAssistantEnabled}
            setIsAssistantEnabled={setIsAssistantEnabled}
          />
        </div>
      </>
    );
  }
  return (
    <div className={styles.loginPrompt}>
      <p>Please sign in to access the chat.</p>
    </div>
  );
};
export default Chat;
