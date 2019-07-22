import PropTypes from 'prop-types';
import React, {Component} from 'react';

export default class ErrorBoundary extends Component {
    static propTypes = {
        children: PropTypes.node,
    };

    constructor(props) {
        super(props);
        this.state = {hasError: false};
    }

    componentDidCatch(error, info) {
        this.setState({hasError: true});
        console.error(error, info);
    }

    render() {
        if (this.state.hasError) {
            return <p className="p-2">(error)</p>;
        }
        return this.props.children;
    }
}
