import { Search } from 'lucide-react'
import './SearchInput.css'

// Presentation only: the surrounding label and consumer retain search behavior.
export default function SearchInput({ className = '', ...props }) {
  return <span className="search-box">
    <Search className="search-icon" size={16} aria-hidden="true" focusable="false" />
    <input {...props} type="search" className={`search-input ${className}`.trim()} />
  </span>
}
