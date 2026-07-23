export type WorkPhase='Build'|'Inspection'|'Shipping';

export function canEmployeeBuild(employee:any){
  return !!employee && employee.canBuild!==false;
}

export function canEmployeeInspect(employee:any){
  return !!employee && employee.canInspect!==false;
}

export function canEmployeeShip(employee:any){
  return !!employee && employee.canShip!==false;
}

export function canEmployeeForPhase(employee:any,phase:WorkPhase='Build'){
  if(phase==='Inspection')return canEmployeeInspect(employee);
  if(phase==='Shipping')return canEmployeeShip(employee);
  return canEmployeeBuild(employee);
}

export function isEligibleEmployeeForPhase(employee:any,phase:WorkPhase='Build'){
  return !!employee && employee.active!==false && canEmployeeForPhase(employee,phase);
}
