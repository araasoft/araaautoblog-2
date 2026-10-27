import { motion } from "framer-motion";
import Icon from "./Icon";

export default function Card({ title, icon, children, className = "", style, animate = true, ...rest }) {
  const Comp = animate ? motion.div : "div";
  const anim = animate ? { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.25 } } : {};
  return (
    <Comp className={`card ${className}`} style={style} {...anim} {...rest}>
      {title && (
        <h2>
          {icon && <Icon name={icon} />} {title}
        </h2>
      )}
      {children}
    </Comp>
  );
}
