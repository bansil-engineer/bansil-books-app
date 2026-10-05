'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

export interface UniversalSearchResult {
  id: string;
  sourceType: string;
  title: string;
  subtitle: string;
  snippet: string;
  amount?: number;
  date?: string;
  deeplink?: string;
  matchScore: number;
}

export function UniversalSearchOverlay() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UniversalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const delayDebounceFn = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.results || []);
        }
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setLoading(false);
        setSelectedIndex(0);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [query]);

  // Navigation handlers
  const handleResultKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        handleSelect(results[selectedIndex]);
      }
    }
  };

  const handleSelect = (item: UniversalSearchResult) => {
    setIsOpen(false);
    if (item.deeplink) {
      router.push(item.deeplink);
    } else {
      // Fallback behavior if no deeplink is provided
      console.log('Selected:', item);
      alert(`Selected ${item.title}`);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/50 backdrop-blur-sm" onClick={() => setIsOpen(false)}>
      <div 
        className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh] border border-gray-200 dark:border-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <svg className="w-5 h-5 text-gray-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent border-none outline-none text-lg text-gray-900 dark:text-gray-100 placeholder-gray-400"
            placeholder="Search Bills, Invoices, Items, Activities..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleResultKeyDown}
          />
          <div className="text-xs text-gray-400 border border-gray-200 dark:border-gray-700 rounded px-2 py-1">ESC to close</div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-8 text-center text-gray-500">Searching...</div>
          )}
          
          {!loading && query && results.length === 0 && (
            <div className="p-8 text-center text-gray-500">No results found for "{query}"</div>
          )}

          {!loading && results.map((result, index) => (
            <div
              key={`${result.sourceType}-${result.id}`}
              className={`p-3 border-b border-gray-100 dark:border-gray-800 cursor-pointer flex flex-col gap-1
                ${index === selectedIndex ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}
              onClick={() => handleSelect(result)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                    {result.sourceType}
                  </span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">{result.title}</span>
                </div>
                {result.date && (
                  <span className="text-xs text-gray-500">{result.date}</span>
                )}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-300">{result.subtitle}</div>
              <div className="text-xs text-gray-500 truncate">{result.snippet}</div>
              {result.amount !== undefined && (
                <div className="text-sm font-medium text-gray-700 dark:text-gray-200 mt-1">₹{result.amount.toFixed(2)}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
