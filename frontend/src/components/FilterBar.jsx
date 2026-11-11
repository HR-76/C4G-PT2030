import './FilterBar.css'

// Layout only: each consumer owns query state, requests and authorization.
export default function FilterBar({ as: Element = 'div', variant = 'default', className = '', children, ...props }) {
  return <Element className={`filter-bar filter-bar-${variant} ${className}`} {...props}>{children}</Element>
}
