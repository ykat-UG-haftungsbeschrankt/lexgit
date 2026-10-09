import { Component } from "react";
import type { ComponentProps } from "react";
import RepositoryHistory from "./RepositoryHistory";

export default class RepositorySidebar extends Component<ComponentProps<typeof RepositoryHistory>>{
	public render(){
		return <aside className="history-sidebar" aria-label="Repository-Versionen">
			<RepositoryHistory {...this.props}/>
		</aside>;
	}
}
