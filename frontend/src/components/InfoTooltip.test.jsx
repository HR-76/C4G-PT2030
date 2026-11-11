import {afterEach,expect,it} from 'vitest'
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react'
import InfoTooltip from './InfoTooltip'

afterEach(cleanup)

it('connects a named information control to its tooltip',()=>{
 render(<InfoTooltip label="Informação sobre a página">Contexto importante.</InfoTooltip>)
 const button=screen.getByRole('button',{name:'Informação sobre a página'})
 const tooltip=document.getElementById(button.getAttribute('aria-describedby'))
 expect(tooltip?.getAttribute('role')).toBe('tooltip')
 expect(tooltip?.textContent).toBe('Contexto importante.')
})

it('clamps every repeated focus to the viewport without measuring a previous transform',()=>{
 Object.defineProperty(window,'innerWidth',{configurable:true,value:390})
 Object.defineProperty(window,'innerHeight',{configurable:true,value:844})
 render(<InfoTooltip label="Informação sobre a página">Contexto importante.</InfoTooltip>)
 const button=screen.getByRole('button',{name:'Informação sobre a página'})
 const tooltip=document.getElementById(button.getAttribute('aria-describedby'))
 button.getBoundingClientRect=()=>({left:210,right:254,top:100,bottom:144,width:44,height:44})
 Object.defineProperty(tooltip,'offsetHeight',{configurable:true,value:60})
 fireEvent.focus(button)
 expect(tooltip.style.getPropertyValue('--info-tooltip-width')).toBe('358px')
 expect(tooltip.style.getPropertyValue('--info-tooltip-left')).toBe('16px')
 expect(tooltip.style.getPropertyValue('--info-tooltip-top')).toBe('152px')
 fireEvent.blur(button)
 fireEvent.focus(button)
 expect(tooltip.style.getPropertyValue('--info-tooltip-left')).toBe('16px')
})

it('dismisses with Escape without moving focus and reopens on a fresh focus',()=>{
 render(<><InfoTooltip label="Ajuda">Contexto importante.</InfoTooltip><button>Seguinte</button></>)
 const button=screen.getByRole('button',{name:'Ajuda'})
 act(()=>button.focus())
 expect(screen.getByRole('tooltip')).toBeTruthy()
 fireEvent.keyDown(button,{key:'Escape'})
 expect(screen.queryByRole('tooltip')).toBeNull()
 expect(document.activeElement).toBe(button)
 act(()=>screen.getByRole('button',{name:'Seguinte'}).focus())
 act(()=>button.focus())
 expect(screen.getByRole('tooltip')).toBeTruthy()
})

it('dismisses a pointer-open tooltip with Escape and reopens only after re-entry',()=>{
 render(<InfoTooltip label="Ajuda">Contexto importante.</InfoTooltip>)
 const button=screen.getByRole('button',{name:'Ajuda'})
 fireEvent.mouseEnter(button)
 expect(screen.getByRole('tooltip')).toBeTruthy()
 fireEvent.keyDown(document,{key:'Escape'})
 expect(screen.queryByRole('tooltip')).toBeNull()
 fireEvent.mouseLeave(button)
 fireEvent.mouseEnter(button)
 expect(screen.getByRole('tooltip')).toBeTruthy()
 fireEvent.mouseLeave(button)
 expect(screen.queryByRole('tooltip')).toBeNull()
})

it('keeps keyboard help open when the pointer leaves and closes it after blur',()=>{
 render(<><InfoTooltip label="Ajuda">Contexto importante.</InfoTooltip><button>Seguinte</button></>)
 const button=screen.getByRole('button',{name:'Ajuda'})
 act(()=>button.focus())
 fireEvent.mouseEnter(button)
 fireEvent.mouseLeave(button)
 expect(screen.getByRole('tooltip')).toBeTruthy()
 act(()=>screen.getByRole('button',{name:'Seguinte'}).focus())
 expect(screen.queryByRole('tooltip')).toBeNull()
})
