import {useCallback,useEffect,useId,useRef,useState} from 'react'
import {Info} from 'lucide-react'
import './InfoTooltip.css'

export default function InfoTooltip({label='Mais informação',children,align='left'}){
 const id=useId()
 const root=useRef(null)
 const button=useRef(null)
 const panel=useRef(null)
 const hovered=useRef(false),focused=useRef(false)
 const [open,setOpen]=useState(false)
 const place=useCallback(()=>{
  if(!button.current||!panel.current||typeof window==='undefined')return
  const gutter=16,gap=8,anchor=button.current.getBoundingClientRect()
  const width=Math.min(360,Math.max(0,window.innerWidth-gutter*2))
  panel.current.style.setProperty('--info-tooltip-width',`${width}px`)
  const height=panel.current.offsetHeight
  const preferredLeft=align==='right'?anchor.right-width:anchor.left
  const left=Math.max(gutter,Math.min(preferredLeft,window.innerWidth-gutter-width))
  const below=anchor.bottom+gap,above=anchor.top-height-gap
  const spaceBelow=window.innerHeight-anchor.bottom-gap-gutter,spaceAbove=anchor.top-gap-gutter
  const preferredTop=height<=spaceBelow||spaceBelow>=spaceAbove?below:above
  const top=Math.max(gutter,Math.min(preferredTop,window.innerHeight-gutter-height))
  panel.current.style.setProperty('--info-tooltip-left',`${left}px`)
  panel.current.style.setProperty('--info-tooltip-top',`${top}px`)
  panel.current.dataset.side=preferredTop===below?'below':'above'
 },[align])
 useEffect(()=>{
  if(!open)return
  const dismiss=event=>{
   if(event.key!=='Escape')return
   event.preventDefault();event.stopPropagation();setOpen(false)
  }
  window.addEventListener('resize',place)
  window.addEventListener('scroll',place,true)
  document.addEventListener('keydown',dismiss,true)
  return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);document.removeEventListener('keydown',dismiss,true)}
 },[open,place])
 const show=()=>{place();setOpen(true)}
 return <span ref={root} className={`info-tooltip info-tooltip-${align}`} data-open={open}
  onMouseEnter={()=>{hovered.current=true;show()}}
  onMouseLeave={()=>{hovered.current=false;if(!focused.current)setOpen(false)}}
  onFocusCapture={()=>{focused.current=true;show()}}
  onBlurCapture={event=>{if(root.current?.contains(event.relatedTarget))return;focused.current=false;if(!hovered.current)setOpen(false)}}>
  <button ref={button} type="button" className="info-tooltip-button" aria-label={label} aria-describedby={id}><Info size={18} aria-hidden="true"/></button>
  <span ref={panel} id={id} className="info-tooltip-panel" role="tooltip" aria-hidden={!open}>{children}</span>
 </span>
}
